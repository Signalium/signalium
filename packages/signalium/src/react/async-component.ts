import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type * as ReactTypes from 'react';
import { getCurrentConsumer, setCurrentConsumer } from '../internals/consumer.js';
import { createReactiveSignal, ReactiveSignal } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { isReactivePromise, ReactivePromiseImpl } from '../internals/async.js';
import { hashValue } from '../internals/utils/hash.js';
import { isPromise, isThennable } from '../internals/utils/type-utils.js';
import { useScope } from './context.js';
import { usePauseSignalsManager } from './pause-signals-context.js';

/**
 * Remembers settled outcomes for yielded thenables so synchronous replay can inject
 * `next(value)` on later attempts without throwing the same fulfilled promise again (which
 * can strand Suspense). Identity must be stable across replays for a given logical await.
 */
const thenableOutcome = new WeakMap<
  object,
  { kind: 'fulfilled'; value: unknown } | { kind: 'rejected'; reason: unknown }
>();

function adoptYieldedThenable(thenable: object): unknown {
  const expanded = thenable as { status?: string; value?: unknown; reason?: unknown };
  if (expanded.status === 'fulfilled') {
    return expanded.value;
  }
  if (expanded.status === 'rejected') {
    throw expanded.reason;
  }
  if (expanded.status === 'pending') {
    throw thenable;
  }

  const hit = thenableOutcome.get(thenable);
  if (hit !== undefined) {
    if (hit.kind === 'rejected') {
      throw hit.reason;
    }
    return hit.value;
  }

  (thenable as PromiseLike<unknown>).then(
    v => {
      thenableOutcome.set(thenable, { kind: 'fulfilled', value: v });
    },
    e => {
      thenableOutcome.set(thenable, { kind: 'rejected', reason: e });
    },
  );
  throw thenable;
}

/** Marked on the outer wrapper returned by `component()` for async (generator) definitions. */
export const SIGNALIUM_ASYNC_COMPONENT = Symbol.for('signalium.asyncComponent');

/**
 * Call from wrappers around `use()` if you might receive a Signalium async component by mistake.
 * React's `use()` does not support Signalium async `component()` wrappers — render them under
 * `<Suspense>` and use `await` inside the component (after the async transform) instead.
 */
export function throwIfSignaliumAsyncComponentPassedToUse(resource: unknown): void {
  if (
    typeof resource === 'function' &&
    (resource as { [SIGNALIUM_ASYNC_COMPONENT]?: boolean })[SIGNALIUM_ASYNC_COMPONENT] === true
  ) {
    throw new Error(
      'use() with a Signalium async `component()` is not supported. Render the component under <Suspense> and use await inside the component (compiled from async/await by the Signalium preset) instead.',
    );
  }
}

export { isGeneratorFunction, isAsyncFunctionWithoutTransform } from './component-shared.js';

/**
 * Synchronous replay driver for async `component()` (authoring: `async`/`await`; Babel rewrites to a generator).
 *
 * Each React render starts a **new** iterator and walks it in a tight loop. Each `yield` (from
 * the compiled generator, originally `await`) is treated like `use(promise)` / Suspense: pending
 * thenables **throw** (interrupting the render); settled `ReactivePromise` values are injected via
 * `next(value)` and the loop continues in the same turn.
 *
 * **Hooks after a suspending `await`:** Same family as React `use()` — the throw aborts before
 * later code runs; the next attempt replays from the top. Do not use conditional hooks without
 * Suspense on paths that skip them.
 *
 * **Plain `Promise` / other thenables:** First time pending, **throw** for Suspense and register
 * the outcome in a `WeakMap` keyed by thenable identity. After settlement, the **same** object
 * replays inject the value (or throw the rejection) synchronously. Keep **stable thenable
 * identity** across replays (e.g. store in a ref). Thenables may expose React `use()`-style
 * `status` / `value` / `reason` for synchronous reads when present.
 *
 * **Generator `let` / `const`:** Reset every replay; durable state should use React hooks, refs, or
 * Signalium signals.
 *
 * `ownerSignal` is set as `CURRENT_CONSUMER` so reads inside the generator participate in the
 * reactive graph like `compute` in `runSignal`.
 */
export function runSyncReplayAsyncComponent<P extends object>(
  fn: (props: P) => Generator<any, ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, unknown>,
  props: P,
  ownerSignal: ReactiveSignal<ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, []>,
): ReactTypes.ReactNode | ReactTypes.ReactNode[] | null {
  const prevConsumer = getCurrentConsumer();
  try {
    setCurrentConsumer(ownerSignal);
    const iter = fn(props);
    let sent: unknown = undefined;
    for (;;) {
      const step = iter.next(sent as never);
      if (step.done) {
        return step.value as ReactTypes.ReactNode | ReactTypes.ReactNode[] | null;
      }
      const yielded = step.value as unknown;

      if (yielded !== null && typeof yielded === 'object' && isReactivePromise(yielded as object)) {
        const rp = yielded as ReactivePromiseImpl<unknown>;
        if (rp.isRejected) {
          throw rp.error;
        }
        if (!rp.isReady) {
          const native = (rp as unknown as { _promise?: Promise<unknown> })._promise;
          throw native !== undefined ? native : (rp as Promise<unknown>);
        }
        sent = rp.value;
        continue;
      }

      if (yielded !== null && typeof yielded === 'object' && (isPromise(yielded as object) || isThennable(yielded))) {
        sent = adoptYieldedThenable(yielded as object);
        continue;
      }

      sent = yielded;
    }
  } finally {
    setCurrentConsumer(prevConsumer);
  }
}

/**
 * Async Signalium `component()`: one lazy reactive signal per **instance** (same as sync
 * `component()`), outer `useMemo` keyed by `hashValue(props)`. No definition-scoped props map.
 */
export function createAsyncComponentWrapper<P extends object>(
  fn: (props: P) => Generator<any, ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, unknown>,
): (props: P) => ReactTypes.ReactNode {
  const Inner = (props: P) => {
    const scope = useScope();
    const manager = usePauseSignalsManager();

    const fnSignalRef = useRef<ReactiveSignal<ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, []> | undefined>(
      undefined,
    );
    const propsRef = useRef(props);
    propsRef.current = props;

    let sig: ReactiveSignal<ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, []> | undefined = fnSignalRef.current;
    if (sig === undefined) {
      let owned!: ReactiveSignal<ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, []>;
      owned = createReactiveSignal(
        {
          compute: () => runSyncReplayAsyncComponent(fn, propsRef.current, owned),
          equals: () => false,
          isRelay: false,
          tracer: undefined,
        },
        [],
        undefined,
        scope,
      );
      owned._isLazy = true;
      fnSignalRef.current = sig = owned;
    }

    const watch = !manager?.paused;
    manager?.register(sig);

    useEffect(() => {
      return () => manager?.unregister(sig!);
    }, [manager, sig]);

    useSyncExternalStore(
      sig.addListenerLazy(watch),
      () => sig!.updatedCount,
      () => sig!.updatedCount,
    );

    runSignal(sig as ReactiveSignal<any, any[]>);

    return sig.value;
  };

  const Outer = (props: P) => {
    const hash = hashValue(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => React.createElement(Inner, props), [hash]);
  };

  Object.defineProperty(Outer, SIGNALIUM_ASYNC_COMPONENT, { value: true, enumerable: false });

  return Outer as (props: P) => ReactTypes.ReactNode;
}
