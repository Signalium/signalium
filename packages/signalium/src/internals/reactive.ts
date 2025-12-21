import WeakRef from './weakref.js';
import { Tracer, getTracerProxy, TracerMeta } from './trace.js';
import { ReactiveValue, Equals, ReactiveOptions } from '../types.js';
import { getUnknownSignalFnName } from './utils/debug-name.js';
import { SignalScope } from './contexts.js';
import { getSignal } from './get.js';
import { Edge } from './edge.js';
import { cancelPull, schedulePull, scheduleUnwatch } from './scheduling.js';
import { hashValue } from './utils/hash.js';
import { stringifyValue } from './utils/stringify.js';
import { Callback } from './callback.js';
import { watchSignal } from './watch.js';
import { equalsFrom } from './utils/equals.js';

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
  isLazy = 0b100000,
}

let ID = 0;

interface ListenerMeta {
  updatedAt: number;
  current: Set<() => void>;

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
  return {
    id,
    desc,
    compute,
    equals: equalsFrom(equals),
    isRelay,
    paramKey,
    tracer,
  };
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

  // Reference to the shared definition
  def: ReactiveDefinition<T, Args>;

  constructor(def: ReactiveDefinition<T, Args>, args: Args, key?: SignalId, scope?: SignalScope) {
    this.flags = (def.isRelay ? ReactiveFnFlags.isRelay : 0) | ReactiveFnState.Dirty;
    this.scope = scope;
    this.key = key;
    this.args = args;
    this.def = def;

    if (IS_DEV && getTracerProxy() !== undefined) {
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

  set _isListener(isListener: boolean) {
    if (isListener) {
      this.flags |= ReactiveFnFlags.isListener;
    } else {
      this.flags &= ~ReactiveFnFlags.isListener;
    }
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
        current: new Set(),
        cachedBoundAdd: this.addListener.bind(this),
      })
    );
  }

  get value() {
    return getSignal(this);
  }

  addListener(listener: () => void) {
    const { current } = this.listeners;

    if (!current.has(listener)) {
      if (!this._isListener) {
        watchSignal(this);
        this.flags |= ReactiveFnFlags.isListener;
      }

      schedulePull(this);

      current.add(listener);
    }

    return () => {
      if (current.has(listener)) {
        current.delete(listener);

        if (current.size === 0) {
          cancelPull(this);
          scheduleUnwatch(this);
          this.flags &= ~ReactiveFnFlags.isListener;
        }
      }
    };
  }

  // This method is used in React hooks specifically. It returns a bound add method
  // that is cached to avoid creating a new one on each call, and it eagerly sets
  // the listener as watched so that relays that are accessed will be activated.
  addListenerLazy() {
    if (!this._isListener) {
      watchSignal(this);
      this.flags |= ReactiveFnFlags.isListener;
    }

    return this.listeners.cachedBoundAdd;
  }
}

export const runListeners = (signal: ReactiveSignal<any, any>) => {
  const { listeners } = signal;

  if (listeners === null) {
    return;
  }

  const { current } = listeners;

  for (const listener of current) {
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
