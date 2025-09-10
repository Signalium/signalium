import {
  ReactivePromise as IReactivePromise,
  ReactiveTask,
  Equals,
  ReactiveOptions,
  RelayActivate,
  RelayHooks,
  DiscriminatedReactivePromise,
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
import { CURRENT_CONSUMER } from './consumer.js';
import { createCallback } from './callback.js';

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

export class ReactivePromise<T> implements IReactivePromise<T> {
  private _value: T | undefined = undefined;

  private _error: unknown | undefined = undefined;
  private _flags = AsyncFlags.Pending;

  private _signal: ReactiveFnSignal<any, any> | undefined = undefined;
  private _equals: Equals<T> = DEFAULT_EQUALS as Equals<T>;
  private _promise: Promise<T> | undefined;

  private _pending: PendingResolve<T>[] = [];

  private _stateSubs = new Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, number>();
  _awaitSubs = new Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, PromiseEdge>();

  // Version is not really needed in a pure signal world, but when integrating
  // with non-signal code, it's sometimes needed to entangle changes to the promise.
  // For example, in React we need to entangle each promise immediately after it
  // was used because we can't dynamically call hooks.
  private _version = signal(0);

  // Private but exposed for the ReactiveTask interface so we don't have to create a new
  // class and make all this code polypmorphic
  private run: ((...args: unknown[]) => ReactivePromise<T>) | undefined = undefined;

  constructor(executor?: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason: unknown) => void) => void) {
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
  ): ReactivePromise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
    const p = new ReactivePromise();
    const arr = arrayFrom(values);
    const len = arr.length;
    if (len === 0) {
      p._setValue([] as any);
      return p as unknown as ReactivePromise<any>;
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
    return p as unknown as ReactivePromise<any>;
  }

  static race<T extends readonly unknown[] | []>(values: T): ReactivePromise<Awaited<T[number]>> {
    const p = new ReactivePromise();
    const arr = arrayFrom(values);
    const len = arr.length;
    if (len === 0) return p as unknown as ReactivePromise<any>;
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
    return p as unknown as ReactivePromise<any>;
  }

  static any<T>(values: Iterable<T | PromiseLike<T>>): ReactivePromise<Awaited<T>>;
  static any<T extends readonly unknown[] | []>(values: T): ReactivePromise<Awaited<T[number]>> {
    const p = new ReactivePromise();
    const arr = arrayFrom(values);
    const len = arr.length;

    if (len === 0) {
      // Like native Promise.any([]): reject with AggregateError
      p._setError(new AggregateError([], 'No promises were provided to ReactivePromise.any'));
      return p as unknown as ReactivePromise<any>;
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

    return p as unknown as ReactivePromise<any>;
  }

  static allSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>;
  static allSettled<T extends readonly unknown[] | []>(
    values: T,
  ): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }> {
    const p = new ReactivePromise();
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

  static resolve<T>(value: T): ReactivePromise<T> {
    if (value instanceof ReactivePromise) return value as unknown as ReactivePromise<T>;
    return new ReactivePromise<T>(resolve => resolve(value)) as unknown as ReactivePromise<T>;
  }

  static reject<T = never>(reason: any): ReactivePromise<T> {
    return new ReactivePromise<T>((_resolve, reject) => reject(reason)) as unknown as ReactivePromise<T>;
  }

  static withResolvers<T>() {
    const p = new ReactivePromise<T>();
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

    return { promise: p as unknown as ReactivePromise<T>, resolve, reject } as const;
  }

  private _initFlags(baseFlags: number) {
    this._flags = baseFlags;
  }

  private _consumeFlags(flags: number) {
    if (CURRENT_CONSUMER === undefined) return;

    if ((this._flags & AsyncFlags.isRelay) !== 0) {
      this._connect();
    }

    const ref = CURRENT_CONSUMER.ref;

    const subs = this._stateSubs;

    const subbedFlags = subs.get(ref) ?? 0;
    subs.set(ref, subbedFlags | flags);
  }

  private _connect() {
    const signal = this._signal as ReactiveFnSignal<any, any>;

    if (CURRENT_CONSUMER?.watchCount === 0) {
      const { ref, computedCount, deps } = CURRENT_CONSUMER!;
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
  }

  _setPending() {
    this._setFlags(AsyncFlags.Pending);
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
      this._setPending();
      dirtySignalConsumers(awaitSubs);
      this._awaitSubs = awaitSubs = new Map();
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

    this._scheduleSubs(awaitSubs, notifyFlags !== 0);

    this._setFlags(AsyncFlags.Resolved | AsyncFlags.Ready, AsyncFlags.Pending | AsyncFlags.Rejected, notifyFlags);

    for (const { ref, edge, resolve } of this._pending) {
      resolve?.(value!);

      if (ref !== undefined) {
        awaitSubs.set(ref, edge!);
      }
    }

    this._pending = [];
  }

  private _setError(nextError: unknown, awaitSubs = this._awaitSubs) {
    let error = this._error;

    let notifyFlags = 0;

    if (error !== nextError) {
      this._error = error = nextError;
      notifyFlags = AsyncFlags.Error;
    }

    this._scheduleSubs(awaitSubs, notifyFlags !== 0);

    this._setFlags(AsyncFlags.Rejected, AsyncFlags.Pending | AsyncFlags.Resolved, notifyFlags);

    for (const { ref, edge, reject } of this._pending) {
      reject?.(error);

      if (ref !== undefined) {
        awaitSubs.set(ref, edge!);
      }
    }

    this._pending = [];
  }

  private _scheduleSubs(awaitSubs: Map<WeakRef<ReactiveFnSignal<unknown, unknown[]>>, PromiseEdge>, dirty: boolean) {
    // Await subscribers that have been added since the promise was set are specifically
    // subscribers that were previously notified and MaybeDirty, were removed from the
    // signal, and then were checked (e.g. checkSignal was called on them) and they
    // halted and added themselves back as dependencies.
    //
    // If the value actually changed, then these consumers are Dirty and will notify and
    // schedule themselves the standard way here. If the value did not change, then the
    // consumers are not notified and end up back in the same state as before the promise
    // was set (because nothing changed), and instead they will be scheduled to continue
    // the computation from where they left off.
    const newState = dirty ? ReactiveFnState.Dirty : ReactiveFnState.MaybeDirty;

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

      if (CURRENT_CONSUMER !== undefined) {
        if ((flags & AsyncFlags.isRelay) !== 0) {
          this._connect();
        }

        ref = CURRENT_CONSUMER.ref;

        const prevEdge =
          this._awaitSubs.get(ref!) ?? findAndRemoveDirty(CURRENT_CONSUMER, this as ReactivePromise<any>);

        edge = createEdge(prevEdge, EdgeType.Promise, this as ReactivePromise<any>, -1, CURRENT_CONSUMER.computedCount);
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

export function isReactivePromise(value: object): value is ReactivePromise<unknown> {
  return value.constructor === ReactivePromise;
}

export function isRelay<T>(obj: unknown): obj is ReactivePromise<T> {
  return obj instanceof ReactivePromise && (obj['_flags'] & AsyncFlags.isRelay) !== 0;
}

export function createPromise<T>(promise: Promise<T>, signal: ReactiveFnSignal<T, unknown[]>) {
  const p = new ReactivePromise<T>();

  p['_signal'] = signal;
  p['_equals'] = signal.def.equals;
  p['_initFlags'](AsyncFlags.Pending);
  p['_setPromise'](promise);

  return p;
}

export function createRelay<T>(activate: RelayActivate<T>, scope: SignalScope, opts?: ReactiveOptions<T, unknown[]>) {
  const p = new ReactivePromise<T>();

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
  const p = new ReactivePromise<T>();

  const { fn } = createCallback(task, scope);

  p['_equals'] = equalsFrom(opts?.equals);
  p['_initFlags'](AsyncFlags.isRunnable);

  p['run'] = ((...args: Args) => {
    p._setPromise(fn(...args));

    return p;
  }) as any;

  return p as unknown as ReactiveTask<T, Args>;
}
