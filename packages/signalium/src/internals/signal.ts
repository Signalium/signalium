import { getTracerProxy, TracerEventType } from './trace.js';
import { Signal, Equals, SignalOptions, Notifier } from '../types.js';
import { dirtySignal } from './dirty.js';
import { getCurrentConsumer, type ReactiveConsumer } from './consumer.js';
import { scheduleListeners } from './scheduling.js';
import { DEFAULT_EQUALS, FALSE_EQUALS } from './utils/equals.js';

let STATE_ID = 0;

const SIGNAL_BRAND = Symbol.for('signalium.signal');

export function isSignal(value: unknown): value is Signal<unknown> {
  return typeof value === 'object' && value !== null && (value as any)[SIGNAL_BRAND] === true;
}

export class StateSignal<T> implements Signal<T> {
  // SIGNAL_BRAND is set on the prototype below the class definition rather than
  // as an instance field, so we don't pay a per-instance Symbol-keyed slot.
  private _value: T;
  private _equals: Equals<T>;
  private _subs: Set<ReactiveConsumer> | ReactiveConsumer | null = null;
  private _listeners: Set<() => void> | null = null;

  constructor(value: T, equals: Equals<T> = DEFAULT_EQUALS as Equals<T>, desc: string = 'signal') {
    this._value = value;
    this._equals = equals;

    if (IS_DEV) {
      (this as any)._id = STATE_ID++;
      (this as any)._desc = desc;
    }
  }

  get value(): T {
    this.consume();

    return this._value;
  }

  update(fn: (value: T) => T) {
    this.value = fn(this._value);
  }

  set value(value: T) {
    if (this._equals(value, this._value)) {
      return;
    }

    this._value = value;

    this.notify();
  }

  consume(): void {
    const currentConsumer = getCurrentConsumer();
    if (currentConsumer !== undefined) {
      if (IS_DEV) {
        const tracer = getTracerProxy();
        tracer?.emit({
          type: TracerEventType.ConsumeState,
          id: currentConsumer.tracerMeta!.id,
          name: (this as any)._desc,
          childId: (this as any)._id,
          value: this._value,
          setValue: (value: unknown) => {
            this.value = value as T;
          },
        });
      }

      let subs = this._subs;
      if (subs === null) {
        this._subs = subs = currentConsumer;
      } else if (subs instanceof Set) {
        subs.add(currentConsumer);
      } else {
        const newSubs = new Set<ReactiveConsumer>();
        newSubs.add(currentConsumer);
        newSubs.add(subs);
        this._subs = newSubs;
      }

      let stateDeps = currentConsumer.stateDeps;
      if (stateDeps === null) {
        currentConsumer.stateDeps = this;
      } else if (stateDeps instanceof WeakSet) {
        stateDeps.add(this);
      } else {
        const newStateDeps = new WeakSet();
        newStateDeps.add(this);
        newStateDeps.add(stateDeps);
        currentConsumer.stateDeps = newStateDeps;
      }
    }
  }

  notify(): void {
    const subs = this._subs;

    if (subs === null) {
      return;
    }

    if (subs instanceof Set) {
      for (const sub of subs) {
        const stateDeps = sub.stateDeps!;

        if (stateDeps === this || (stateDeps as WeakSet<object>).has(this)) {
          dirtySignal(sub);
        }
      }
    } else {
      dirtySignal(subs);
    }
  }
}

// Place SIGNAL_BRAND on the prototype rather than every instance.
// `isSignal` walks the proto chain when reading the symbol, so this is
// fully equivalent for the consumer-facing check while saving an own-property
// per StateSignal instance.
(StateSignal.prototype as any)[SIGNAL_BRAND] = true;

export function signal<T>(initialValue: T, opts?: SignalOptions<T>): Signal<T> {
  const equals =
    opts?.equals === false
      ? FALSE_EQUALS
      : (opts?.equals ?? (DEFAULT_EQUALS as Equals<T>));

  return new StateSignal(initialValue, equals, opts?.desc) as Signal<T>;
}

export const notifier = (opts?: SignalOptions<undefined>) => {
  return new StateSignal(undefined, FALSE_EQUALS, opts?.desc) as Notifier;
};
