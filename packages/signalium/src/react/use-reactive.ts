/* eslint-disable react-hooks/rules-of-hooks */
import { useCallback, useSyncExternalStore } from 'react';
import { ReactiveValue, Signal, ReactivePromise } from '../types.js';
import { getReactiveFnAndDefinition } from '../internals/core-api.js';
import { getCurrentConsumer } from '../internals/consumer.js';
import { ReactiveFnSignal } from '../internals/reactive.js';
import { isReactivePromise, isRelay, ReactivePromiseImpl } from '../internals/async.js';
import { StateSignal } from '../internals/signal.js';
import { useScope } from './context.js';
import { getGlobalScope } from '../internals/contexts.js';

const useStateSignal = <T>(signal: Signal<T>): T => {
  return useSyncExternalStore(
    useCallback(onStoreChange => (signal as StateSignal<T>).addListener(onStoreChange), [signal]),
    () => signal.value,
    () => signal.value,
  );
};

const useReactiveFnSignal = <R, Args extends unknown[]>(signal: ReactiveFnSignal<R, Args>): ReactiveValue<R> => {
  return useSyncExternalStore(
    signal.addListenerLazy(),
    () => signal.value,
    () => signal.value,
  );
};

const useReactivePromise = <R>(promise: ReactivePromiseImpl<R>): ReactivePromise<R> => {
  if (isRelay(promise)) {
    useReactiveFnSignal(promise['_signal'] as ReactiveFnSignal<any, unknown[]>);
  }

  useStateSignal(promise['_version']);

  return promise as ReactivePromise<R>;
};

const useReactiveFn = <R, Args extends readonly Narrowable[]>(fn: (...args: Args) => R, ...args: Args): R => {
  const [, def] = getReactiveFnAndDefinition(fn as any);

  const scope = useScope() ?? getGlobalScope();

  const signal = scope.get(def, args as any);
  const value = useReactiveFnSignal(signal);

  // Reactive promises can update their value independently of the signal, since
  // we reuse the same promise object for each result. We need to entangle the
  // version of the promise here so that we can trigger a re-render when the
  // promise value updates.
  //
  // If hooks could be called in dynamic order this would not be necessary, we
  // could entangle the promise when it is used. But, because that is not the
  // case, we need to eagerly entangle.
  if (typeof value === 'object' && value !== null && isReactivePromise(value)) {
    return useReactivePromise(value) as R;
  }

  return value as R;
};

const isNonNullishAsyncSignal = (value: unknown): value is ReactivePromise<unknown> => {
  return typeof value === 'object' && value !== null && isReactivePromise(value as object);
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Narrowable = string | number | boolean | null | undefined | bigint | symbol | {};

export function useReactive<R>(signal: Signal<R>): R;
export function useReactive<R>(signal: ReactivePromise<R>): ReactivePromise<R>;
export function useReactive<R, Args extends readonly Narrowable[]>(fn: (...args: Args) => R, ...args: Args): R;
export function useReactive<R, Args extends readonly Narrowable[]>(
  signal: Signal<R> | ReactivePromise<R> | ((...args: Args) => R),
  ...args: Args
): R | ReactivePromise<R> {
  if (getCurrentConsumer()) {
    if (typeof signal === 'function') {
      return signal(...args);
    } else if (isNonNullishAsyncSignal(signal)) {
      return signal as ReactivePromise<R>;
    } else {
      return (signal as Signal<R>).value;
    }
  }

  if (typeof signal === 'function') {
    return useReactiveFn(signal, ...args);
  } else if (typeof signal === 'object' && signal !== null && isReactivePromise(signal)) {
    return useReactivePromise(signal) as ReactivePromise<R>;
  } else {
    return useStateSignal(signal as Signal<R>);
  }
}
