/* eslint-disable react-hooks/rules-of-hooks */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { ReactiveValue, Signal, ReactivePromise, ReadonlySignal } from '../types.js';
import { getReactiveFnAndDefinition, reactiveSignal } from '../internals/core-api.js';
import { getCurrentConsumer } from '../internals/consumer.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { isReactivePromise, isRelay, ReactivePromiseImpl } from '../internals/async.js';
import { snapshot } from '../internals/utils/snapshot.js';
import { StateSignal } from '../internals/signal.js';
import { useScope } from './context.js';
import { useSignalsSuspended } from './suspend-signals-context.js';
import { getGlobalScope } from '../internals/contexts.js';

const useStateSignal = <T>(signal: Signal<T>): T => {
  const suspended = useSignalsSuspended();
  return useSyncExternalStore(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(suspended ? () => () => {} : onStoreChange => (signal as StateSignal<T>).addListener(onStoreChange), [
      signal,
      suspended,
    ]),
    () => signal.value,
    () => signal.value,
  );
};

const useReactiveFnSignal = <R, Args extends unknown[]>(signal: ReactiveSignal<R, Args>): ReactiveValue<R> => {
  const suspended = useSignalsSuspended();

  signal.setSuspended(suspended);

  return useSyncExternalStore(
    signal.addListenerLazy(),
    () => signal.value,
    () => signal.value,
  );
};

const useReactivePromise = <R>(promise: ReactivePromiseImpl<R>): ReactivePromise<R> => {
  if (isRelay(promise)) {
    useReactiveFnSignal(promise['_signal'] as ReactiveSignal<any, unknown[]>);
  }

  useStateSignal(promise['_version']);

  return promise as ReactivePromise<R>;
};

/**
 * Resolves a thunk or `reactive()`-registered fn to its scope-cached
 * `ReactiveSignal` and subscribes. For inline thunks, `getReactiveFnAndDefinition`
 * memoizes the `ReactiveDefinition` in a `WeakMap` keyed by fn identity, so a
 * memoized thunk (via `useCallback` or the Signalium Babel preset) reuses the
 * same def + scope-cached signal across renders. A fresh fn each render
 * (pathological fallback case) produces a fresh signal per render, which is
 * correct but slower.
 */
const useReactiveFn = <R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => R,
  ...args: Args
): ReactiveValue<R> => {
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
    return useReactivePromise(value) as unknown as ReactiveValue<R>;
  }

  return value as ReactiveValue<R>;
};

const isNonNullishAsyncSignal = (value: unknown): value is ReactivePromise<unknown> => {
  return typeof value === 'object' && value !== null && isReactivePromise(value as object);
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Narrowable = string | number | boolean | null | undefined | bigint | symbol | {};

export function useReactive<R>(fn: () => R): ReactiveValue<R>;
export function useReactive<R>(signal: Signal<R>): R;
export function useReactive<R>(signal: ReactivePromise<R>): ReactivePromise<R>;
export function useReactive<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => R,
  ...args: Args
): ReactiveValue<R>;
export function useReactive<R, Args extends readonly Narrowable[]>(
  signal: Signal<R> | ReactivePromise<R> | ((...args: Args) => R),
  ...args: Args
): ReactiveValue<R> | R | ReactivePromise<R> {
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

export function useReactiveDeep<R>(fn: () => R): ReactiveValue<R>;
export function useReactiveDeep<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => R,
  ...args: Args
): ReactiveValue<R>;
export function useReactiveDeep<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => R,
  ...args: Args
): ReactiveValue<R> {
  if (getCurrentConsumer()) {
    throw new Error(
      'useReactiveDeep cannot be used inside of a reactive context. You can use the signal/function directly instead.',
    );
  }

  const suspended = useSignalsSuspended();

  const scope = useScope() ?? getGlobalScope();
  const signalRef = useRef<ReadonlySignal<R> | undefined>(undefined);
  const cloneSignalRef = useRef<ReactiveSignal<R, any> | undefined>(undefined);
  const valueRef = useRef<R | undefined>(undefined);

  const [, def] = getReactiveFnAndDefinition(fn as any);

  const signal = scope.get(def, args as any) as ReactiveSignal<R, any>;

  if (signalRef.current !== signal) {
    signalRef.current = signal;
    valueRef.current = undefined;

    cloneSignalRef.current = reactiveSignal(() => {
      const next = snapshot(signal.value, valueRef.current) as R;

      valueRef.current = next;

      return next;
    }) as ReactiveSignal<R, any>;
  }

  const cloneSignal = cloneSignalRef.current!;

  cloneSignal.setSuspended(suspended);

  return useSyncExternalStore(
    cloneSignal.addListenerLazy(),
    () => cloneSignal.value as ReactiveValue<R>,
    () => cloneSignal.value as ReactiveValue<R>,
  );
}
