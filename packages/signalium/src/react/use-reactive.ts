/* eslint-disable react-hooks/rules-of-hooks */
import { useCallback, useSyncExternalStore } from 'react';
import { RelaySignal, AsyncSignal, SignalValue, Signal } from '../types.js';
import { DERIVED_DEFINITION_MAP } from '../core-api.js';
import { expect } from '../type-utils.js';
import { isRelaySignal } from '../internals/async.js';
import { CURRENT_CONSUMER } from '../internals/consumer.js';
import { ReactiveFnSignal } from '../internals/reactive.js';
import { isAsyncSignalImpl } from '../internals/utils/type-utils.js';
import { AsyncSignalImpl } from '../internals/async.js';
import { StateSignal } from '../internals/signal.js';
import { useScope } from './context.js';
import { GLOBAL_SCOPE } from '../internals/contexts.js';

const useStateSignal = <T>(signal: StateSignal<T>): T => {
  return useSyncExternalStore(
    useCallback(onStoreChange => signal.addListener(onStoreChange), [signal]),
    () => signal.value,
    () => signal.value,
  );
};

const useReactiveFnSignal = <R, Args extends unknown[]>(signal: ReactiveFnSignal<R, Args>): SignalValue<R> => {
  return useSyncExternalStore(
    signal.addListenerLazy(),
    () => signal.value,
    () => signal.value,
  );
};

const useAsyncSignal = <R>(promise: AsyncSignalImpl<R>): AsyncSignalImpl<R> => {
  if (isRelaySignal(promise)) {
    useReactiveFnSignal(promise['_signal'] as ReactiveFnSignal<any, unknown[]>);
  }

  useStateSignal(promise['_version']);

  return promise;
};

const useReactiveFn = <R, Args extends readonly Narrowable[]>(fn: (...args: Args) => R, ...args: Args): R => {
  const def = expect(DERIVED_DEFINITION_MAP.get(fn), 'Expected to find a derived definition for the function');

  const scope = useScope() ?? GLOBAL_SCOPE;

  const signal = scope.get(def, args);
  const value = useReactiveFnSignal(signal);

  // Reactive promises can update their value independently of the signal, since
  // we reuse the same promise object for each result. We need to entangle the
  // version of the promise here so that we can trigger a re-render when the
  // promise value updates.
  //
  // If hooks could be called in dynamic order this would not be necessary, we
  // could entangle the promise when it is used. But, because that is not the
  // case, we need to eagerly entangle.
  if (typeof value === 'object' && value !== null && isAsyncSignalImpl(value)) {
    return useAsyncSignal(value) as R;
  }

  return value;
};

const isNonNullishAsyncSignal = (value: unknown): value is AsyncSignalImpl<unknown> => {
  return typeof value === 'object' && value !== null && isAsyncSignalImpl(value);
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Narrowable = string | number | boolean | null | undefined | bigint | symbol | {};

export function useReactive<R>(signal: Signal<R>): R;
export function useReactive<R>(signal: RelaySignal<R>): RelaySignal<R>;
export function useReactive<R>(signal: AsyncSignal<R>): AsyncSignal<R>;
export function useReactive<R, Args extends readonly Narrowable[]>(fn: (...args: Args) => R, ...args: Args): R;
export function useReactive<R, Args extends readonly Narrowable[]>(
  signal: Signal<R> | RelaySignal<R> | AsyncSignal<R> | ((...args: Args) => R),
  ...args: Args
): R | AsyncSignal<R> | RelaySignal<R> {
  if (CURRENT_CONSUMER) {
    if (typeof signal === 'function') {
      return signal(...args);
    } else if (isNonNullishAsyncSignal(signal)) {
      return signal as AsyncSignalImpl<R>;
    } else {
      return (signal as Signal<R>).value;
    }
  }

  if (typeof signal === 'function') {
    return useReactiveFn(signal, ...args);
  } else if (typeof signal === 'object' && signal !== null && isAsyncSignalImpl(signal)) {
    return useAsyncSignal(signal) as AsyncSignalImpl<R>;
  } else {
    return useStateSignal(signal as StateSignal<R>);
  }
}
