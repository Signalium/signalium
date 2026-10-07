import { useRef } from 'react';
import { ReactiveValue } from '../types.js';
import { getReactiveFnAndDefinition, reactiveSignal } from '../internals/core-api.js';
import { getCurrentConsumer } from '../internals/consumer.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { snapshot } from '../internals/utils/snapshot.js';
import { useScope } from './context.js';
import { addRenderListener, usePausableStore, usePauseSignalsManager } from './pause-signals-context.js';
import { getGlobalScope } from '../internals/contexts.js';
import { useDeliveryMode, useStateDelivery, useStateDeliveryState, type ReactReaderOptions } from './delivery.js';

/** Options for `useReactive` / `useReactiveShallow`. */
export type ReactiveHookOptions = ReactReaderOptions;

function useSignalWithSuspension(signal: ReactiveSignal<any, any>, options: ReactiveHookOptions | undefined) {
  const manager = usePauseSignalsManager();
  const delivery = useDeliveryMode(options?.delivery);
  const subscribe = addRenderListener(signal, manager);

  // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
  if (delivery === 'state') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const stateDelivery = useStateDeliveryState(signal);
    const value = signal.value;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useStateDelivery(stateDelivery, signal, subscribe, signal.updatedCount, manager);
    return value;
  }

  const getSnapshot = () => signal.value;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePausableStore(manager, signal, subscribe, getSnapshot);
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

  const subscribe = addRenderListener(cloneSignal, manager);

  // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
  if (delivery === 'state') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const stateDelivery = useStateDeliveryState(cloneSignal);
    const value = cloneSignal.value as ReactiveValue<R>;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useStateDelivery(stateDelivery, cloneSignal, subscribe, cloneSignal.updatedCount, manager);
    return value;
  }

  const getSnapshot = () => cloneSignal.value as ReactiveValue<R>;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePausableStore(manager, cloneSignal, subscribe, getSnapshot);
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
