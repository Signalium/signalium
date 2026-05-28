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

class StateSub {
  sub: ReactiveConsumer;
  consumedAt: number;
  next: StateSub | null;

  constructor(sub: ReactiveConsumer, consumedAt: number, next: StateSub | null) {
    this.sub = sub;
    this.consumedAt = consumedAt;
    this.next = next;
  }
}

export class StateSignal<T> implements Signal<T> {
  // SIGNAL_BRAND is set on the prototype below the class definition rather than
  // as an instance field, so we don't pay a per-instance Symbol-keyed slot.
  private _value: T;
  private _equals: Equals<T>;
  private _subsHead: StateSub | null = null;
  private _lastSub: ReactiveConsumer | null = null;
  private _lastNode: StateSub | null = null;
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

      const lastNode = this._lastNode;
      if (this._lastSub === currentConsumer && lastNode !== null) {
        lastNode.consumedAt = currentConsumer.computedCount;
      } else {
        const node = new StateSub(currentConsumer, currentConsumer.computedCount, this._subsHead);
        this._subsHead = node;
        this._lastSub = currentConsumer;
        this._lastNode = node;
      }
    }
  }

  notify(): void {
    let node = this._subsHead;
    if (node !== null) {
      while (node !== null) {
        const { sub, consumedAt } = node;
        if (consumedAt === sub.computedCount) {
          dirtySignal(sub);
        }

        node = node.next;
      }

      this._subsHead = null;
      this._lastSub = null;
      this._lastNode = null;
    }

    scheduleListeners(this);
  }

  addListener(listener: () => void): () => void {
    let listeners = this._listeners;

    if (listeners === null) {
      this._listeners = listeners = new Set();
    }

    listeners.add(listener);

    return () => listeners.delete(listener);
  }
}

// Place SIGNAL_BRAND on the prototype rather than every instance.
// `isSignal` walks the proto chain when reading the symbol, so this is
// fully equivalent for the consumer-facing check while saving an own-property
// per StateSignal instance.
(StateSignal.prototype as any)[SIGNAL_BRAND] = true;

export function runListeners(signal: StateSignal<any>) {
  const listeners = signal['_listeners'];

  if (listeners === null) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

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
