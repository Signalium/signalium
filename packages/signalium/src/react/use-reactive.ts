import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ReactiveValue } from '../types.js';
import { getReactiveFnAndDefinition, reactiveSignal } from '../internals/core-api.js';
import { getCurrentConsumer } from '../internals/consumer.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { snapshot } from '../internals/utils/snapshot.js';
import { useScope } from './context.js';
import { usePauseSignalsManager } from './pause-signals-context.js';
import { getGlobalScope } from '../internals/contexts.js';
import { useDeliveryMode, useStateDelivery, type ReactReaderOptions } from './delivery.js';

/** Options for `useReactive` / `useReactiveShallow`. */
export type ReactiveHookOptions = ReactReaderOptions;

function useSignalWithSuspension(signal: ReactiveSignal<any, any>, options: ReactiveHookOptions | undefined) {
  const manager = usePauseSignalsManager();
  const watch = !manager?.paused;
  const delivery = useDeliveryMode(options?.delivery);

  const subscribe = signal.addListenerLazy(watch);
  let value;

  // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
  if (delivery === 'state') {
    value = signal.value;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useStateDelivery(signal, subscribe, signal.updatedCount);
  } else {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    value = useSyncExternalStore(
      subscribe,
      () => signal.value,
      () => signal.value,
    );
  }

  // Register on commit, not during render: a render React discards must not leave the signal in
  // the manager, where un-pausing would watch it again with nothing left to release it. The commit
  // may happen under a different pause state than the render took its lease under, so registering
  // reconciles the watch the subscriptions hold. The signal is scope-cached and may be shared with
  // other readers, so the manager counts registrations: it keeps pausing the signal until the
  // last of them unmounts.
  useEffect(() => {
    if (manager === null) return;
    manager.register(signal);
    return () => manager.unregister(signal);
  }, [manager, signal]);

  return value;
}

/**
 * Subscribe to a reactive thunk without structural cloning. The thunk's
 * `ReactiveDefinition` is memoized by fn identity in a `WeakMap`, so a
 * memoized thunk (via `useCallback` or the Signalium Babel preset) reuses the
 * same scope-cached signal across renders.
 *
 * This is a minimal wrapper: the returned value is whatever the thunk
 * returned, by reference. In particular, when the thunk returns a
 * `ReactivePromise`, re-renders only fire when the underlying signal itself
 * re-evaluates (e.g. a new promise replaces the old one) — not when the
 * existing promise transitions from pending to resolved. If you need promise
 * state transitions to drive React, read its fields inside the thunk (e.g.
 * `useReactiveShallow(() => { const p = fetchThing(); return { value: p.value,
 * isPending: p.isPending }; })`) or use {@link useReactive} for the
 * structurally-shared snapshot that handles this automatically.
 */
export function useReactiveShallow<R>(fn: () => R, options?: ReactiveHookOptions): ReactiveValue<R> {
  if (IS_DEV && getCurrentConsumer()) {
    throw new Error(
      'signalium: `useReactiveShallow` cannot be called inside a reactive function. ' +
        'Call your reactive function directly instead — it already participates in the signal graph.',
    );
  }

  const [, def] = getReactiveFnAndDefinition(fn);
  const scope = useScope() ?? getGlobalScope();
  const signal = scope.get(def, [] as []);

  return useSignalWithSuspension(signal, options) as ReactiveValue<R>;
}

/**
 * Subscribe to a reactive thunk and return a structurally-shared snapshot of
 * its value. Nested objects/arrays/Maps/Sets are deep-cloned; unchanged
 * subtrees keep the same reference, so React's referential equality works as
 * expected. ReactivePromise values are flattened to plain objects.
 *
 * This is the default hook for reading reactive values inside a React
 * component — it gives you safe equality semantics at the React boundary.
 * Use {@link useReactiveShallow} if you know you don't need structural
 * sharing.
 */
export function useReactive<R>(fn: () => R, options?: ReactiveHookOptions): ReactiveValue<R> {
  if (IS_DEV && getCurrentConsumer()) {
    throw new Error(
      'signalium: `useReactive` cannot be called inside a reactive function. ' +
        'Call your reactive function directly instead — it already participates in the signal graph.',
    );
  }

  const manager = usePauseSignalsManager();
  const watch = !manager?.paused;
  const delivery = useDeliveryMode(options?.delivery);

  const scope = useScope() ?? getGlobalScope();
  const innerSignalRef = useRef<ReactiveSignal<R, []> | undefined>(undefined);
  const cloneSignalRef = useRef<ReactiveSignal<ReactiveValue<R>, []> | undefined>(undefined);
  const valueRef = useRef<ReactiveValue<R> | undefined>(undefined);

  const [, def] = getReactiveFnAndDefinition(fn);

  const signal = scope.get(def, [] as []) as ReactiveSignal<R, []>;

  if (innerSignalRef.current !== signal) {
    innerSignalRef.current = signal;
    valueRef.current = undefined;

    cloneSignalRef.current = reactiveSignal(() => {
      const next = snapshot(signal.value, valueRef.current) as ReactiveValue<R>;
      valueRef.current = next;
      return next;
    }) as ReactiveSignal<ReactiveValue<R>, []>;
  }

  const cloneSignal = cloneSignalRef.current!;

  const subscribe = cloneSignal.addListenerLazy(watch);
  let value: ReactiveValue<R>;

  // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
  if (delivery === 'state') {
    value = cloneSignal.value as ReactiveValue<R>;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useStateDelivery(cloneSignal, subscribe, cloneSignal.updatedCount);
  } else {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    value = useSyncExternalStore(
      subscribe,
      () => cloneSignal.value as ReactiveValue<R>,
      () => cloneSignal.value as ReactiveValue<R>,
    );
  }

  // Like `component()`, register the clone signal with the pause manager on commit, after the store
  // subscription, reconciling its watch with the pause state it committed under.
  useEffect(() => {
    if (manager === null) return;
    manager.register(cloneSignal);
    return () => manager.unregister(cloneSignal);
  }, [manager, cloneSignal]);

  return value;
}

/**
 * @deprecated Use {@link useReactive} instead. `useReactive` is now
 * deep-by-default; `useReactiveDeep` is a thin alias kept for back-compat and
 * will be removed in a future major release.
 */
export function useReactiveDeep<R>(fn: () => R, options?: ReactiveHookOptions): ReactiveValue<R> {
  if (IS_DEV) {
    warnUseReactiveDeepOnce();
  }
  return useReactive(fn, options);
}

let _useReactiveDeepWarned = false;
function warnUseReactiveDeepOnce() {
  if (_useReactiveDeepWarned) return;
  _useReactiveDeepWarned = true;
  console.warn(
    '[signalium] `useReactiveDeep` is deprecated; use `useReactive` instead. ' +
      '`useReactive` is now deep-by-default. Use `useReactiveShallow` to opt out of structural snapshots.',
  );
}
