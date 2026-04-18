import { useRef, useSyncExternalStore } from 'react';
import { ReactiveValue } from '../types.js';
import { getReactiveFnAndDefinition, reactiveSignal } from '../internals/core-api.js';
import { getCurrentConsumer } from '../internals/consumer.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { snapshot } from '../internals/utils/snapshot.js';
import { useScope } from './context.js';
import { useSignalsSuspended } from './suspend-signals-context.js';
import { getGlobalScope } from '../internals/contexts.js';

const useReactiveFnSignal = <R, Args extends unknown[]>(signal: ReactiveSignal<R, Args>): ReactiveValue<R> => {
  const suspended = useSignalsSuspended();

  signal.setSuspended(suspended);

  return useSyncExternalStore(
    signal.addListenerLazy(),
    () => signal.value,
    () => signal.value,
  );
};

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
export function useReactiveShallow<R>(fn: () => R): ReactiveValue<R> {
  if (IS_DEV && getCurrentConsumer()) {
    throw new Error(
      'signalium: `useReactiveShallow` cannot be called inside a reactive function. ' +
        'Call your reactive function directly instead — it already participates in the signal graph.',
    );
  }

  const [, def] = getReactiveFnAndDefinition(fn);
  const scope = useScope() ?? getGlobalScope();
  const signal = scope.get(def, [] as []);

  return useReactiveFnSignal(signal) as ReactiveValue<R>;
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
export function useReactive<R>(fn: () => R): ReactiveValue<R> {
  if (IS_DEV && getCurrentConsumer()) {
    throw new Error(
      'signalium: `useReactive` cannot be called inside a reactive function. ' +
        'Call your reactive function directly instead — it already participates in the signal graph.',
    );
  }

  const suspended = useSignalsSuspended();

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

  cloneSignal.setSuspended(suspended);

  return useSyncExternalStore(
    cloneSignal.addListenerLazy(),
    () => cloneSignal.value as ReactiveValue<R>,
    () => cloneSignal.value as ReactiveValue<R>,
  );
}

/**
 * @deprecated Use {@link useReactive} instead. `useReactive` is now
 * deep-by-default; `useReactiveDeep` is a thin alias kept for back-compat and
 * will be removed in a future major release.
 */
export function useReactiveDeep<R>(fn: () => R): ReactiveValue<R> {
  if (IS_DEV) {
    warnUseReactiveDeepOnce();
  }
  return useReactive(fn);
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
