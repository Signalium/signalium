import { Tracer, getTracerProxy, TracerMeta } from './trace.js';
import { ReactiveValue, Equals, ReactiveOptions } from '../types.js';
import { getUnknownSignalFnName } from './utils/debug-name.js';
import { SignalScope } from './contexts.js';
import { getSignal } from './get.js';
import { Edge } from './edge.js';
import { cancelPull, schedulePull } from './scheduling.js';
import { hashValue } from './utils/hash.js';
import { stringifyValue } from './utils/stringify.js';
import { Callback } from './callback.js';
import { unwatchSignal, watchSignal } from './watch.js';
import { equalsFrom } from './utils/equals.js';
import { dirtySignal } from './dirty.js';
import { addLease, removeLease } from './lease.js';

/**
 * This file contains computed signal base types and struct definitions.
 *
 * Computed signals are monomorphic to make them more efficient, but this also
 * means that multiple fields differ based on the type of the signal. Defining
 * them using this pattern rather than a class allows us to switch on the `type`
 * field to get strong typing in branches everywhere else.
 *
 * "Methods" for this struct are defined in other files for better organization.
 */

export type SignalId = number;

export const enum ReactiveFnState {
  Clean = 0,
  Pending = 1,
  Dirty = 2,
  MaybeDirty = 3,
  PendingDirty = 4,
}

export const enum ReactiveFnFlags {
  // State
  State = 0b111,

  // Properties
  isRelay = 0b1000,
  isListener = 0b10000,
  isActive = 0b100000,
  isLazy = 0b1000000,
  // Listener status taken by a render and not yet claimed by a subscription; see `lease.ts`.
  isLeased = 0b10000000,
  // The listener status holds a watch. Clear while paused.
  isListenerWatched = 0b100000000,
}

let ID = 0;

interface ListenerMeta {
  updatedAt: number;
  current: Map<() => void, () => void>;

  // Subscribers under a paused `PauseSignalsProvider`. The watch is held while any is unpaused.
  pausedReaders: number;

  // Cached bound add method to avoid creating a new one on each call, this is
  // specifically for React hooks where useSyncExternalStore will resubscribe each
  // time if the method is not cached. This prevents us from having to add a
  // useCallback for the listener.
  cachedBoundAdd: (listener: () => void) => () => void;
}

/**
 * Shared definition for derived signals to reduce memory usage.
 * Contains configuration that's common across all instances of a reactive function.
 */
export interface ReactiveDefinition<T, Args extends unknown[]> extends ReactiveOptions<T, Args> {
  compute: (...args: Args) => T;
  equals: Equals<T>;
  isRelay: boolean;
  tracer: Tracer | undefined;
}

/**
 * Unified way to create a reactive definition (protects shaping)
 */
export function createReactiveDefinition<T, Args extends unknown[]>(
  id: string | undefined,
  desc: string | undefined,
  compute: (...args: Args) => T,
  equals: Equals<T> | false | undefined,
  isRelay: boolean,
  paramKey: ((...args: Args) => string | number) | undefined,
  tracer: Tracer | undefined,
): ReactiveDefinition<T, Args> {
  const def: ReactiveDefinition<T, Args> = {
    compute,
    equals: equalsFrom(equals),
    isRelay,
    paramKey,
    tracer: undefined,
  };

  if (IS_DEV) {
    def.id = id;
    def.desc = desc;
    def.tracer = tracer;
  }

  return def;
}

export class ReactiveSignal<T, Args extends unknown[]> {
  // Bitmask containing state in the first 2 bits and boolean properties in the remaining bits
  private flags: number;
  scope: SignalScope | undefined = undefined;

  id = ++ID;

  subs = new Map<WeakRef<ReactiveSignal<any, any>>, Edge>();
  deps = new Map<ReactiveSignal<any, any>, Edge>();

  ref: WeakRef<ReactiveSignal<T, Args>> = new WeakRef(this);

  dirtyHead: Edge | undefined = undefined;

  updatedCount: number = 0;
  computedCount: number = 0;

  watchCount: number = 0;

  key: SignalId | undefined;
  args: Args;
  callbacks: Callback[] | undefined = undefined;

  _listeners: ListenerMeta | null = null;
  _value: ReactiveValue<T> | undefined = undefined;

  tracerMeta?: TracerMeta;
  desc: string | undefined;

  // Reference to the shared definition
  def: ReactiveDefinition<T, Args>;

  constructor(def: ReactiveDefinition<T, Args>, args: Args, key?: SignalId, scope?: SignalScope) {
    this.flags = (def.isRelay ? ReactiveFnFlags.isRelay : 0) | ReactiveFnState.Dirty;
    this.scope = scope;
    this.key = key;
    this.args = args;
    this.def = def;
    this.desc = def.desc;

    if (IS_DEV) {
      this.tracerMeta = {
        id: def.id ?? key ?? hashValue([def.compute, ID++]),
        desc: def.desc ?? def.compute.name ?? getUnknownSignalFnName(def.compute),
        params: args.map(arg => stringifyValue(arg)).join(', '),
        tracer: def.tracer,
      };
    }
  }

  get _state() {
    return this.flags & ReactiveFnFlags.State;
  }

  set _state(state: ReactiveFnState) {
    this.flags = (this.flags & ~ReactiveFnFlags.State) | state;
  }

  get _isListener() {
    return (this.flags & ReactiveFnFlags.isListener) !== 0;
  }

  get _isActive() {
    return (this.flags & ReactiveFnFlags.isActive) !== 0;
  }

  set _isActive(isActive: boolean) {
    if (isActive) {
      this.flags |= ReactiveFnFlags.isActive;
    } else {
      this.flags &= ~ReactiveFnFlags.isActive;
    }
  }

  get _isLeased() {
    return (this.flags & ReactiveFnFlags.isLeased) !== 0;
  }

  get _isLazy() {
    return (this.flags & ReactiveFnFlags.isLazy) !== 0;
  }

  set _isLazy(isLazy: boolean) {
    if (isLazy) {
      this.flags |= ReactiveFnFlags.isLazy;
    } else {
      this.flags &= ~ReactiveFnFlags.isLazy;
    }
  }

  get listeners() {
    return (
      this._listeners ??
      (this._listeners = {
        updatedAt: 0,
        current: new Map(),
        pausedReaders: 0,
        cachedBoundAdd: this.addListener.bind(this),
      })
    );
  }

  get value() {
    return getSignal(this);
  }

  addListener(listener: () => void, opts?: { skipInitial?: boolean }) {
    const meta = this.listeners;
    const { current } = meta;

    if (!current.has(listener)) {
      let effective = listener;

      if (opts?.skipInitial) {
        let initial = true;
        effective = () => {
          if (initial) {
            initial = false;
            return;
          }
          listener();
        };
      }

      const flags = this.flags;

      if ((flags & ReactiveFnFlags.isListener) === 0) {
        this.flags = flags | ReactiveFnFlags.isListener;
      } else if ((flags & ReactiveFnFlags.isLeased) !== 0) {
        // Claim the render lease; its watch now belongs to the listeners.
        this.flags = flags & ~ReactiveFnFlags.isLeased;
        removeLease(this);
      }

      current.set(listener, effective);

      if (meta.pausedReaders < current.size) {
        this._takeListenerWatch();
      } else {
        this._pauseWatch();
      }

      if (this.watchCount > 0) {
        schedulePull(this);
      }
    }

    return () => {
      if (current.has(listener)) {
        current.delete(listener);

        if (current.size === 0) {
          cancelPull(this);

          const flags = this.flags;
          this.flags = flags & ~(ReactiveFnFlags.isListener | ReactiveFnFlags.isListenerWatched);

          if ((flags & ReactiveFnFlags.isListenerWatched) !== 0) {
            unwatchSignal(this);
          }

          meta.updatedAt = 0;
        } else if (meta.pausedReaders >= current.size) {
          this._pauseWatch();
        }
      }
    };
  }

  // This method is used in React hooks specifically. It returns a bound add method
  // that is cached to avoid creating a new one on each call, and it eagerly sets
  // the listener as watched so that relays that are accessed will be activated.
  //
  // The eager watch is a lease (see `lease.ts`): the commit's subscription claims it, and a
  // discarded render's lease expires. Each render of a still-leased signal extends it.
  addListenerLazy(watch = true) {
    const flags = this.flags;

    if ((flags & ReactiveFnFlags.isListener) === 0) {
      if (watch) {
        // `watchSignal` writes `flags`, so set ours after it.
        watchSignal(this);
        this.flags |= ReactiveFnFlags.isListener | ReactiveFnFlags.isLeased | ReactiveFnFlags.isListenerWatched;
      } else {
        this.flags |= ReactiveFnFlags.isListener | ReactiveFnFlags.isLeased;
      }

      addLease(this);
    } else if ((flags & ReactiveFnFlags.isLeased) !== 0) {
      if (watch && (flags & ReactiveFnFlags.isListenerWatched) === 0) {
        watchSignal(this);
        this.flags |= ReactiveFnFlags.isListenerWatched;
      }

      addLease(this);
    }

    return this.listeners.cachedBoundAdd;
  }

  /** Drops the listener watch; listeners stay subscribed. */
  _pauseWatch() {
    const flags = this.flags;

    if ((flags & ReactiveFnFlags.isListenerWatched) !== 0) {
      this.flags = flags & ~ReactiveFnFlags.isListenerWatched;
      unwatchSignal(this, { isPausing: true });
    }
  }

  /** Retakes the listener watch, pulling changes missed while unwatched. */
  _resumeWatch() {
    if ((this.flags & ReactiveFnFlags.isListener) !== 0 && this._takeListenerWatch()) {
      schedulePull(this);
    }
  }

  private _takeListenerWatch() {
    if ((this.flags & ReactiveFnFlags.isListenerWatched) !== 0) {
      return false;
    }

    // `watchSignal` writes `flags`, so set ours after it.
    watchSignal(this);
    this.flags |= ReactiveFnFlags.isListenerWatched;
    return true;
  }

  /** `deferred` reconciles in a microtask, for a reader that unregisters before it unsubscribes. */
  _addPausedReaders(delta: number, deferred = false) {
    this.listeners.pausedReaders += delta;

    if (deferred) {
      queueMicrotask(() => this._reconcilePausedReaders());
    } else {
      this._reconcilePausedReaders();
    }
  }

  private _reconcilePausedReaders() {
    const { current, pausedReaders } = this.listeners;

    if (current.size === 0) return;

    if (pausedReaders < current.size) {
      this._resumeWatch();
    } else {
      this._pauseWatch();
    }
  }

  /** Releases an unclaimed render lease; a no-op once claimed. */
  _releaseLease() {
    const flags = this.flags;

    if ((flags & ReactiveFnFlags.isLeased) === 0) {
      return;
    }

    this.flags = flags & ~(ReactiveFnFlags.isLeased | ReactiveFnFlags.isListenerWatched | ReactiveFnFlags.isListener);

    if (this._listeners !== null) {
      this._listeners.updatedAt = 0;
    }

    cancelPull(this);

    if ((flags & ReactiveFnFlags.isListenerWatched) !== 0) {
      unwatchSignal(this);
    }
  }
}

export const runListeners = (signal: ReactiveSignal<any, any>) => {
  const { listeners } = signal;

  if (listeners === null) {
    return;
  }

  const { current } = listeners;

  for (const listener of current.values()) {
    listener();
  }
};

export const isRelay = (signal: ReactiveSignal<any, any>): boolean => {
  return (signal['flags'] & ReactiveFnFlags.isRelay) !== 0;
};

export function createReactiveSignal<T, Args extends unknown[]>(
  def: ReactiveDefinition<T, Args>,
  args: Args = [] as any,
  key?: SignalId,
  scope?: SignalScope,
): ReactiveSignal<T, Args> {
  return new ReactiveSignal(def, args, key, scope);
}
