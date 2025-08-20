import WeakRef from '../weakref.js';
import { Tracer, TRACER, TracerMeta } from '../trace.js';
import { SignalValue, SignalEquals, SignalListener, SignalOptionsWithInit } from '../types.js';
import { getUnknownSignalFnName } from './utils/debug-name.js';
import { SignalScope } from './contexts.js';
import { getSignal } from './get.js';
import { Edge } from './edge.js';
import { schedulePull, scheduleUnwatch } from './scheduling.js';
import { hashValue } from './utils/hash.js';
import { stringifyValue } from './utils/stringify.js';

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
}

export const enum ReactiveFnFlags {
  // State
  State = 0b11,

  // Properties
  isRelay = 0b100,
  isListener = 0b1000,
  isLazy = 0b10000,
}

let ID = 0;

interface ListenerMeta {
  updatedAt: number;
  current: Set<SignalListener>;

  // Cached bound add method to avoid creating a new one on each call, this is
  // specifically for React hooks where useSyncExternalStore will resubscribe each
  // time if the method is not cached. This prevents us from having to add a
  // useCallback for the listener.
  cachedBoundAdd: (listener: SignalListener) => () => void;
}

/**
 * Shared definition for derived signals to reduce memory usage.
 * Contains configuration that's common across all instances of a reactive function.
 */
export interface ReactiveFnDefinition<T, Args extends unknown[]>
  extends Partial<Omit<SignalOptionsWithInit<T, Args>, 'scope'>> {
  compute: (...args: Args) => T;
  equals: SignalEquals<T>;
  shouldGC?: (signal: object, value: T, args: Args) => boolean;
  isRelay: boolean;
  tracer?: Tracer;
}

export class ReactiveFnSignal<T, Args extends unknown[]> {
  // Bitmask containing state in the first 2 bits and boolean properties in the remaining bits
  private flags: number;
  scope: SignalScope | undefined = undefined;

  subs = new Map<WeakRef<ReactiveFnSignal<any, any>>, Edge>();
  deps = new Map<ReactiveFnSignal<any, any>, Edge>();

  ref: WeakRef<ReactiveFnSignal<T, Args>> = new WeakRef(this);

  dirtyHead: Edge | undefined = undefined;

  updatedCount: number = 0;
  computedCount: number = 0;

  watchCount: number = 0;

  key: SignalId | undefined;
  args: Args;

  _listeners: ListenerMeta | null = null;
  _value: SignalValue<T> | undefined;

  tracerMeta?: TracerMeta;

  // Reference to the shared definition
  def: ReactiveFnDefinition<T, Args>;

  constructor(def: ReactiveFnDefinition<T, Args>, args: Args, key?: SignalId, scope?: SignalScope) {
    this.flags = (def.isRelay ? ReactiveFnFlags.isRelay : 0) | ReactiveFnState.Dirty;
    this.scope = scope;
    this.key = key;
    this.args = args;
    this.def = def;
    this._value = def.initValue as SignalValue<T>;

    if (TRACER) {
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

  addListener(listener: SignalListener) {
    const { current } = this.listeners;

    if (!current.has(listener)) {
      if (!this._isListener) {
        this.watchCount++;
        this.flags |= ReactiveFnFlags.isListener;
      }

      schedulePull(this);

      current.add(listener);
    }

    return () => {
      if (current.has(listener)) {
        current.delete(listener);

        if (current.size === 0) {
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
      this.watchCount++;
      this.flags |= ReactiveFnFlags.isListener;
    }

    return this.listeners.cachedBoundAdd;
  }
}

export const runListeners = (signal: ReactiveFnSignal<any, any>) => {
  const { listeners } = signal;

  if (listeners === null) {
    return;
  }

  const { current } = listeners;

  for (const listener of current) {
    listener();
  }
};

export const isRelay = (signal: unknown): boolean => {
  return ((signal as any).flags & ReactiveFnFlags.isRelay) !== 0;
};

export function createReactiveFnSignal<T, Args extends unknown[]>(
  def: ReactiveFnDefinition<T, Args>,
  args: Args = [] as any,
  key?: SignalId,
  scope?: SignalScope,
): ReactiveFnSignal<T, Args> {
  return new ReactiveFnSignal(def, args, key, scope);
}
