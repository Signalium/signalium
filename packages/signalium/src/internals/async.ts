import {
  ReactivePromise as IReactivePromise,
  ReactiveTask,
  Equals,
  ReactiveOptions,
  RelayActivate,
  RelayHooks,
  RelayState,
} from '../types.js';
import { createReactiveFnSignal, ReactiveFnSignal, ReactiveFnDefinition, ReactiveFnState } from './reactive.js';
import { getSignal } from './get.js';
import { dirtySignal, dirtySignalConsumers } from './dirty.js';
import { scheduleAsyncPull } from './scheduling.js';
import { createEdge, EdgeType, findAndRemoveDirty, PromiseEdge } from './edge.js';
import { SignalScope } from './contexts.js';
import { signal } from './signal.js';
import { DEFAULT_EQUALS, equalsFrom } from './utils/equals.js';
import { getCurrentConsumer } from './consumer.js';
import { createCallback } from './callback.js';
import { getTracerProxy, TracerEventType } from './trace.js';

const enum AsyncFlags {
  // ======= Notifiers ========

  Pending = 1,
  Rejected = 1 << 1,
  Resolved = 1 << 2,
  Ready = 1 << 3,

  Value = 1 << 4,
  Error = 1 << 5,

  // ======= Properties ========

  isRunnable = 1 << 6,
  isRelay = 1 << 7,

  // ======= Helpers ========

  Settled = Resolved | Rejected,
}

interface PendingResolve<T> {
  ref: WeakRef<ReactiveFnSignal<unknown, unknown[]>> | undefined;
  edge: PromiseEdge | undefined;
  resolve: ((value: T) => void) | undefined | null;
  reject: ((error: unknown) => void) | undefined | null;
}

const arrayFrom = Array.from;

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return v !== null && typeof v === 'object' && typeof (v as any).then === 'function';
}

function thenLoop(v: unknown, onFulfill: (value: unknown) => void, onReject: (reason: unknown) => void): void {
  if (isThenable(v)) {
    (v as PromiseLike<unknown>).then(onFulfill, onReject);
  } else {
    onFulfill(v);
  }
}

export class ReactivePromiseImpl<T> implements IReactivePromise<T> {
  private _value: T | undefined = undefined;

  private _error: unknown | undefined = undefined;
  private _flags = AsyncFlags.Pending;

  private _signal: ReactiveFnSignal<any, any> | undefined = undefined;
  private _equals: Equals<T> = DEFAULT_EQUALS as Equals<T>;
  private _promise: Promise<T> | undefined;

  private _pending: PendingResolve<T>[] = [];

  private _stateSubs = new Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, number>();
  _awaitSubs = new Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, PromiseEdge>();

  _updatedCount = 0;

  // Version is not really needed in a pure signal world, but when integrating
  // with non-signal code, it's sometimes needed to entangle changes to the promise.
  // For example, in React we need to entangle each promise immediately after it
  // was used because we can't dynamically call hooks.
  private _version = signal(0);

  // Private but exposed for the ReactiveTask interface so we don't have to create a new
  // class and make all this code polypmorphic
  private run: ((...args: unknown[]) => ReactivePromiseImpl<T>) | undefined = undefined;

  constructor(executor?: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason: unknown) => void) => void) {
    setReactivePromise(this);

    // If an executor is provided, behave like Promise constructor
    if (executor) {
      const resolve = (value: T | PromiseLike<T>) => {
        if (value && typeof (value as any).then === 'function') {
          this._setPromise(value as Promise<T>);
        } else {
          this._setValue(value as T);
        }
      };
      const reject = (reason: unknown) => {
        this._setError(reason);
      };
      try {
        executor(resolve, reject);
      } catch (e) {
        reject(e);
      }
    }
  }

  static all<T extends readonly unknown[] | []>(
    values: T,
  ): ReactivePromiseImpl<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    const p = new ReactivePromiseImpl();
    const arr = arrayFrom(values);
    const len = arr.length;
    if (len === 0) {
      p._setValue([] as any);
      return p as unknown as ReactivePromiseImpl<any>;
    }
    const results: unknown[] = new Array(len);
    let remaining = len;
    let rejected = false;
    const onFulfillAt = (i: number) => (v: unknown) => {
      if (rejected) return;
      results[i] = v;
      if (--remaining === 0) p._setValue(results as any);
    };
    const onReject = (r: unknown) => {
      if (rejected) return;
      rejected = true;
      p._setError(r);
    };
    for (let i = 0; i < len; i++) {
      thenLoop(arr[i], onFulfillAt(i), onReject);
    }
    return p as unknown as ReactivePromiseImpl<any>;
  }

  static race<T extends readonly unknown[] | []>(values: T): ReactivePromiseImpl<Awaited<T[number]>> {
    const p = new ReactivePromiseImpl();
    const arr = arrayFrom(values);
    const len = arr.length;
    if (len === 0) return p as unknown as ReactivePromiseImpl<any>;
    let settled = false;
    const onFulfill = (v: unknown) => {
      if (settled) return;
      settled = true;
      p._setValue(v as any);
    };
    const onReject = (r: unknown) => {
      if (settled) return;
      settled = true;
      p._setError(r);
    };
    for (let i = 0; i < len; i++) {
      thenLoop(arr[i], onFulfill, onReject);
    }
    return p as unknown as ReactivePromiseImpl<any>;
  }

  static any<T>(values: Iterable<T | PromiseLike<T>>): ReactivePromiseImpl<Awaited<T>>;
  static any<T extends readonly unknown[] | []>(values: T): ReactivePromiseImpl<Awaited<T[number]>> {
    const p = new ReactivePromiseImpl();
    const arr = arrayFrom(values);
    const len = arr.length;

    if (len === 0) {
      // Like native Promise.any([]): reject with AggregateError
      p._setError(new AggregateError([], 'No promises were provided to ReactivePromise.any'));
      return p as unknown as ReactivePromiseImpl<any>;
    }

    let pending = len;
    const errors: unknown[] = new Array(len);
    let fulfilled = false;

    const onFulfill = (value: unknown) => {
      if (fulfilled) return;
      fulfilled = true;
      p._setValue(value as any);
    };
    const onRejectAt = (index: number) => (reason: unknown) => {
      if (fulfilled) return;
      errors[index] = reason;
      if (--pending === 0) {
        p._setError(new AggregateError(errors, 'All promises were rejected in ReactivePromise.any'));
      }
    };

    for (let i = 0; i < len; i++) {
      thenLoop(arr[i], onFulfill, onRejectAt(i));
    }

    return p as unknown as ReactivePromiseImpl<any>;
  }

  static allSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>;
  static allSettled<T extends readonly unknown[] | []>(
    values: T,
  ): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }> {
    const p = new ReactivePromiseImpl();
    const arr = arrayFrom(values);
    const len = arr.length;

    if (len === 0) {
      p._setValue([] as any);
      return p as unknown as Promise<any>;
    }

    const results: PromiseSettledResult<unknown>[] = new Array(len);
    let remaining = len;

    const onFulfillAt = (index: number) => (value: unknown) => {
      results[index] = { status: 'fulfilled', value } as PromiseFulfilledResult<unknown>;
      if (--remaining === 0) p._setValue(results as any);
    };
    const onRejectAt = (index: number) => (reason: unknown) => {
      results[index] = { status: 'rejected', reason } as PromiseRejectedResult;
      if (--remaining === 0) p._setValue(results as any);
    };

    for (let i = 0; i < len; i++) {
      thenLoop(arr[i], onFulfillAt(i), onRejectAt(i));
    }

    return p as unknown as Promise<any>;
  }

  static resolve<T>(value: T): ReactivePromiseImpl<T> {
    if (value instanceof ReactivePromiseImpl) return value as unknown as ReactivePromiseImpl<T>;
    return new ReactivePromiseImpl<T>(resolve => resolve(value)) as unknown as ReactivePromiseImpl<T>;
  }

  static reject<T = never>(reason: any): ReactivePromiseImpl<T> {
    return new ReactivePromiseImpl<T>((_resolve, reject) => reject(reason)) as unknown as ReactivePromiseImpl<T>;
  }

  static withResolvers<T>() {
    const p = new ReactivePromiseImpl<T>();
    p._equals = DEFAULT_EQUALS as Equals<T>;
    p._initFlags(AsyncFlags.Pending);

    const resolve = (value: T | PromiseLike<T>) => {
      if (value && typeof (value as any).then === 'function') {
        p._setPromise(value as Promise<T>);
      } else {
        p._setValue(value as T);
      }
    };
    const reject = (reason: unknown) => {
      p._setError(reason);
    };

    return { promise: p as unknown as ReactivePromiseImpl<T>, resolve, reject } as const;
  }

  private _initFlags(baseFlags: number) {
    const tracer = getTracerProxy();
    if (tracer !== undefined && this._signal !== undefined && (baseFlags & AsyncFlags.Pending) !== 0) {
      tracer.emit({
        type: TracerEventType.StartLoading,
        id: this._signal.tracerMeta!.id,
      });
    }

    this._flags = baseFlags;
  }

  private _consumeFlags(flags: number) {
    const currentConsumer = getCurrentConsumer();
    if (currentConsumer === undefined) return;

    if ((this._flags & AsyncFlags.isRelay) !== 0) {
      this._connect();
    }

    const ref = currentConsumer.ref;

    const subs = this._stateSubs;

    const subbedFlags = subs.get(ref) ?? 0;
    subs.set(ref, subbedFlags | flags);
  }

  private _connect() {
    const signal = this._signal as ReactiveFnSignal<any, any>;

    const currentConsumer = getCurrentConsumer();
    if (currentConsumer?.watchCount === 0) {
      const { ref, computedCount, deps } = currentConsumer;
      const prevEdge = deps.get(signal);

      if (prevEdge?.consumedAt !== computedCount) {
        const newEdge = createEdge(prevEdge, EdgeType.Signal, signal, signal.updatedCount, computedCount);

        signal.subs.set(ref, newEdge);
        deps.set(signal, newEdge);
      }
    } else {
      getSignal(signal);
    }
  }

  private _setFlags(setTrue: number, setFalse = 0, notify = 0) {
    const prevFlags = this._flags;

    const nextFlags = (prevFlags & ~setFalse) | setTrue;
    const allChanged = (prevFlags ^ nextFlags) | notify;

    this._flags = nextFlags;

    if (allChanged === 0) {
      return;
    }

    if ((allChanged & (AsyncFlags.Value | AsyncFlags.Error)) !== 0) {
      this._updatedCount++;
    }

    const subs = this._stateSubs;

    for (const [signalRef, subbedFlags] of subs) {
      if ((subbedFlags & allChanged) !== 0) {
        const signal = signalRef.deref();

        if (signal) {
          dirtySignal(signal);
        }

        subs.delete(signalRef);
      }
    }

    this._version.update(v => v + 1);

    const tracer = getTracerProxy();
    if (tracer !== undefined && this._signal !== undefined) {
      if (setTrue & AsyncFlags.Pending && allChanged & AsyncFlags.Pending) {
        tracer.emit({
          type: TracerEventType.StartLoading,
          id: this._signal.tracerMeta!.id,
        });
      } else if (setFalse & AsyncFlags.Pending && allChanged & AsyncFlags.Pending) {
        tracer.emit({
          type: TracerEventType.EndLoading,
          id: this._signal.tracerMeta!.id,
          value: isRelay(this) ? '...' : this._value,
        });
      }
    }
  }

  _setPending() {
    this._setFlags(AsyncFlags.Pending);
    dirtySignalConsumers(this._awaitSubs);
    return (this._awaitSubs = new Map());
  }

  _clearPending() {
    this._setFlags(0, AsyncFlags.Pending);
  }

  async _setPromise(promise: Promise<T>) {
    // Store the current promise so we can check if it's the same promise in the
    // then handlers. If it's not the same promise, it means that the promise has
    // been recomputed and replaced, so we should not update state.
    this._promise = promise;

    const flags = this._flags;
    let awaitSubs = this._awaitSubs;

    // If we were not already pending, we need to propagate the dirty state to any
    // consumers that were added since the promise was resolved last.
    if ((flags & AsyncFlags.Pending) === 0) {
      awaitSubs = this._setPending();
    }

    try {
      const nextValue = await promise;

      if (promise !== this._promise) {
        return;
      }

      this._setValue(nextValue, awaitSubs);
    } catch (nextError) {
      if (promise !== this._promise) {
        return;
      }

      this._setError(nextError, awaitSubs);
    }
  }

  private _setValue(nextValue: T, awaitSubs = this._awaitSubs) {
    let flags = this._flags;
    let value = this._value;

    let notifyFlags = 0;

    if ((flags & AsyncFlags.Ready) === 0 || this._equals(value!, nextValue) === false) {
      this._value = value = nextValue;
      notifyFlags = AsyncFlags.Value;
    }

    if (flags & AsyncFlags.Rejected) {
      notifyFlags = AsyncFlags.Error;
      this._error = undefined;
    }

    if ((flags & AsyncFlags.Pending) !== 0) {
      this._scheduleSubs(awaitSubs, notifyFlags !== 0);
    } else if (notifyFlags !== 0) {
      dirtySignalConsumers(awaitSubs);
    }

    this._awaitSubs = awaitSubs = new Map();

    this._setFlags(AsyncFlags.Resolved | AsyncFlags.Ready, AsyncFlags.Pending | AsyncFlags.Rejected, notifyFlags);

    const pending = this._pending;
    this._pending = [];

    const updatedAt = this._updatedCount;

    for (const { ref, edge, resolve } of pending) {
      resolve?.(value!);

      if (ref !== undefined) {
        edge!.updatedAt = updatedAt;
        awaitSubs.set(ref, edge!);
      }
    }
  }

  private _setError(nextError: unknown, awaitSubs = this._awaitSubs) {
    let error = this._error;

    let notifyFlags = 0;

    if (error !== nextError) {
      this._error = error = nextError;
      notifyFlags = AsyncFlags.Error;
    }

    if ((this._flags & AsyncFlags.Pending) !== 0) {
      this._scheduleSubs(awaitSubs, notifyFlags !== 0);
    } else if (notifyFlags !== 0) {
      dirtySignalConsumers(awaitSubs);
    }

    this._awaitSubs = awaitSubs = new Map();

    this._setFlags(AsyncFlags.Rejected, AsyncFlags.Pending | AsyncFlags.Resolved, notifyFlags);

    const pending = this._pending;
    this._pending = [];

    const updatedAt = this._updatedCount;

    for (const { ref, edge, reject } of pending) {
      reject?.(error);

      if (ref !== undefined) {
        edge!.updatedAt = updatedAt;
        awaitSubs.set(ref, edge!);
      }
    }
  }

  private _scheduleSubs(awaitSubs: Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, PromiseEdge>, dirty: boolean) {
    /**
     * Await subscribers represent `await` statements, which is why they have a bit
     * of a different notification path in general. But this area in particular is
     * very nuanced.
     *
     * Basically, there are two places where an Await subscriber can be added:
     *
     * 1. `.then()` on the ReactivePromise, e.g. a real `await` statement
     * 2. `checkSignal` on a signal that is a dependency of the ReactivePromise
     *
     * In the first case, we're actually executing the parent function, so when it
     * halts on that `await` statement, it'll automatically start running again
     * when we resolve the promise. This is why we push that subscriber into `pending`,
     * because we don't need to notify that promise until the _next change_.
     *
     * In the second case, we're not actually executing the parent function, we're just
     * checking the signal's dependencies. So to continue "executing" the parent
     * function, we need to schedule it to continue where we left off.
     *
     * So the `_awaitSubs` map we're capturing here is _just_ the subscribers
     * added in the second case, which is why we schedule them eagerly.
     */
    const newState = dirty ? ReactiveFnState.Dirty : ReactiveFnState.PendingDirty;

    for (const ref of awaitSubs.keys()) {
      const signal = ref.deref();

      if (signal === undefined) {
        continue;
      }

      signal._state = newState;

      scheduleAsyncPull(signal);
    }
  }

  get value() {
    this._consumeFlags(AsyncFlags.Value);

    return this._value;
  }

  get error() {
    this._consumeFlags(AsyncFlags.Error);

    return this._error;
  }

  get isPending() {
    this._consumeFlags(AsyncFlags.Pending);

    return (this._flags & AsyncFlags.Pending) !== 0;
  }

  get isRejected() {
    this._consumeFlags(AsyncFlags.Rejected);

    return (this._flags & AsyncFlags.Rejected) !== 0;
  }

  get isResolved() {
    this._consumeFlags(AsyncFlags.Resolved);

    return (this._flags & AsyncFlags.Resolved) !== 0;
  }

  get isReady() {
    this._consumeFlags(AsyncFlags.Ready);

    return (this._flags & AsyncFlags.Ready) !== 0;
  }

  get isSettled() {
    this._consumeFlags(AsyncFlags.Settled);

    return (this._flags & AsyncFlags.Settled) !== 0;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const flags = this._flags;

    // Create a new Promise that will be returned
    return new Promise<TResult1 | TResult2>((resolve, reject) => {
      let ref, edge;

      const currentConsumer = getCurrentConsumer();
      if (currentConsumer !== undefined) {
        if ((flags & AsyncFlags.isRelay) !== 0) {
          this._connect();
        }

        ref = currentConsumer.ref;

        const prevEdge =
          this._awaitSubs.get(ref!) ?? findAndRemoveDirty(currentConsumer, this as ReactivePromiseImpl<any>);

        edge = createEdge(
          prevEdge,
          EdgeType.Promise,
          this as ReactivePromiseImpl<any>,
          this._updatedCount,
          currentConsumer.computedCount,
        );
      }
      // Create wrapper functions that will call the original callbacks and then resolve/reject the new Promise
      const wrappedFulfilled = onfulfilled
        ? (value: T) => {
            try {
              const result = onfulfilled(value);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }
        : (resolve as unknown as (value: T) => void);

      const wrappedRejected = onrejected
        ? (reason: unknown) => {
            try {
              const result = onrejected(reason);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }
        : reject;

      if (flags & AsyncFlags.Pending) {
        this._pending.push({ ref, edge, resolve: wrappedFulfilled, reject: wrappedRejected });
      } else {
        if (flags & AsyncFlags.Resolved) {
          wrappedFulfilled(this._value!);
        } else if (flags & AsyncFlags.Rejected) {
          wrappedRejected(this._error);
        }

        if (ref) {
          this._awaitSubs.set(ref, edge!);
        }
      }
    });
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(null, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then(
      value => {
        onfinally?.();
        return value;
      },
      reason => {
        onfinally?.();
        throw reason;
      },
    );
  }

  get [Symbol.toStringTag](): string {
    return `ReactivePromise`;
  }
}

const REACTIVE_PROMISE_SET = new WeakSet<object>();

/**
 * This is a utility function to mark a value as a ReactivePromise, primarily to enable _proxy_
 * wrapping of ReactivePromises to add additional functionality (see: Signalium Query)
 */
export function setReactivePromise(value: object) {
  REACTIVE_PROMISE_SET.add(value);
}

export function isReactivePromise(value: object): value is ReactivePromiseImpl<unknown> {
  return REACTIVE_PROMISE_SET.has(value);
}

export function isRelay<T>(obj: object): obj is ReactivePromiseImpl<T> {
  return isReactivePromise(obj) && (obj['_flags'] & AsyncFlags.isRelay) !== 0;
}

export function createPromise<T>(promise: Promise<T>, signal: ReactiveFnSignal<T, unknown[]>) {
  const p = new ReactivePromiseImpl<T>();

  p['_signal'] = signal;
  p['_equals'] = signal.def.equals;
  p['_initFlags'](AsyncFlags.Pending);
  p['_setPromise'](promise);

  return p;
}

export function createRelay<T>(activate: RelayActivate<T>, scope: SignalScope, opts?: ReactiveOptions<T, unknown[]>) {
  const p = new ReactivePromiseImpl<T>();

  let active = false;
  let currentSub: RelayHooks | (() => void) | undefined | void;

  const unsubscribe = () => {
    if (typeof currentSub === 'function') {
      currentSub();
    } else if (currentSub !== undefined) {
      currentSub.deactivate?.();
    }

    const signal = p['_signal'] as ReactiveFnSignal<any, any>;

    // Reset the signal state, preparing it for next activation
    signal.subs = new Map();
    signal._state = ReactiveFnState.Dirty;
    signal.watchCount = 0;
    active = false;
    currentSub = undefined;
  };

  const state: RelayState<T> = {
    get value() {
      return p['_value'] as T;
    },

    set value(value: T) {
      p['_setValue'](value);
    },

    setPromise: (promise: Promise<T>) => {
      p['_setPromise'](promise);
    },

    setError: (error: unknown) => {
      p['_setError'](error);
    },
  };

  const def: ReactiveFnDefinition<() => void, unknown[]> = {
    compute: () => {
      if (active === false) {
        currentSub = activate(state);
        active = true;
      } else if (typeof currentSub === 'function' || currentSub === undefined) {
        currentSub?.();
        currentSub = activate(state);
      } else {
        currentSub.update?.();
      }

      return unsubscribe;
    },
    equals: DEFAULT_EQUALS,
    isRelay: true,
    paramKey: opts?.paramKey,
    id: opts?.id,
    desc: opts?.desc,
    tracer: undefined,
  };

  p['_signal'] = createReactiveFnSignal<() => void, unknown[]>(def, [], undefined, scope);

  p['_equals'] = equalsFrom(opts?.equals);
  p['_initFlags'](AsyncFlags.isRelay | AsyncFlags.Pending);

  return p;
}

export function createTask<T, Args extends unknown[]>(
  task: (...args: Args) => Promise<T>,
  scope: SignalScope,
  opts?: ReactiveOptions<T, Args>,
): ReactiveTask<T, Args> {
  const p = new ReactivePromiseImpl<T>();

  const { fn } = createCallback(task, scope);

  p['_equals'] = equalsFrom(opts?.equals);
  p['_initFlags'](AsyncFlags.isRunnable);

  p['run'] = ((...args: Args) => {
    p._setPromise(fn(...args));

    return p;
  }) as any;

  return p as unknown as ReactiveTask<T, Args>;
}

// Type-cast to make sure we don't expose any internal properties
export const ReactivePromise = ReactivePromiseImpl;

// Export the instance type separately to avoid the "value used as type" error
export type ReactivePromise<T> = IReactivePromise<T>;
