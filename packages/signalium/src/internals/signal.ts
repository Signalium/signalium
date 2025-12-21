import { getTracerProxy, TracerEventType } from './trace.js';
import { Signal, Equals, SignalOptions, Notifier } from '../types.js';
import { ReactiveSignal } from './reactive.js';
import { dirtySignal } from './dirty.js';
import { getCurrentConsumer } from './consumer.js';
import { scheduleListeners } from './scheduling.js';

let STATE_ID = 0;

export class StateSignal<T> implements Signal<T> {
  private _value: T;
  private _equals: Equals<T>;
  private _subs = new Map<WeakRef<ReactiveSignal<unknown, unknown[]>>, number>();
  _desc: string;
  _id: number;

  private _listeners: Set<() => void> | null = null;

  constructor(value: T, equals: Equals<T> = (a, b) => a === b, desc: string = 'signal') {
    this._value = value;
    this._equals = equals;
    this._id = STATE_ID++;
    this._desc = desc;
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
          name: this._desc,
          childId: this._id,
          value: this._value,
          setValue: (value: unknown) => {
            this.value = value as T;
          },
        });
      }
      this._subs.set(currentConsumer.ref, currentConsumer.computedCount);
    }
  }

  notify(): void {
    const { _subs: subs } = this;

    for (const [subRef, consumedAt] of subs.entries()) {
      const sub = subRef.deref();

      if (sub === undefined || consumedAt !== sub.computedCount) {
        continue;
      }

      dirtySignal(sub);
    }

    this._subs = new Map();

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

export function runListeners(signal: StateSignal<any>) {
  const listeners = signal['_listeners'];

  if (listeners === null) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

const FALSE_EQUALS: Equals<unknown> = () => false;

export function signal<T>(initialValue: T, opts?: SignalOptions<T>): Signal<T> {
  const equals = opts?.equals === false ? FALSE_EQUALS : (opts?.equals ?? ((a, b) => a === b));

  return new StateSignal(initialValue, equals, opts?.desc) as Signal<T>;
}

export const notifier = (opts?: SignalOptions<undefined>) => {
  return new StateSignal(undefined, FALSE_EQUALS, opts?.desc) as Notifier;
};
