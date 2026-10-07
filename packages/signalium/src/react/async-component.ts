import React, { useMemo, useRef } from 'react';
import type * as ReactTypes from 'react';
import { getCurrentConsumer, setCurrentConsumer } from '../internals/consumer.js';
import { createReactiveSignal, ReactiveSignal } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { isReactivePromise, ReactivePromiseImpl } from '../internals/async.js';
import { usePropsHash } from './props-hash.js';
import { useDeliveryMode, useStateDelivery, type ReactReaderOptions } from './delivery.js';
import { isPromise, isThennable } from '../internals/utils/type-utils.js';
import { useScope } from './context.js';
import { addRenderListener, usePausableStore, usePauseSignalsManager } from './pause-signals-context.js';
import { holdLeaseUntilSettled, holdSuspendedLease, releaseAbandonedAttempt } from '../internals/lease.js';

/**
 * The props of the element a `component()` wrapper rendered, by the props of the inner element it
 * created for them. Lets an inner render find the user's element, which (unlike any render state)
 * survives React retrying a mount that suspended.
 */
const elementPropsByInnerProps = new WeakMap<object, object>();

/**
 * Per user element: the signals of mount attempts that suspended rendering it and still hold a
 * pinned lease. React keeps no render state for a mount that suspends, so its retry creates new
 * signals; the retry releases these once it has leased what it reads.
 */
const suspendedAttemptsByElement = new WeakMap<object, Set<ReactiveSignal<any, any>>>();

/**
 * Creates the inner element a `component()` wrapper renders for the user's element `props`,
 * recording which user element it belongs to (see {@link readComponentSignal}).
 */
export function createComponentElement<P extends object>(
  Inner: (props: P) => ReactTypes.ReactNode,
  props: P,
): ReactTypes.ReactElement {
  const element = React.createElement(Inner, props);
  elementPropsByInnerProps.set(element.props as object, props);
  return element;
}

/**
 * React 19's `use()` (and `useActionState`) suspend by throwing an opaque `SuspenseException`
 * rather than the thenable. It is a plain `Error`; its message is the only stable mark, in
 * development builds and as the error code in minified production builds.
 */
function isReactSuspenseException(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const { message } = error;

  return message.startsWith('Suspense Exception') || /^Minified React error #(460|542)\b/.test(message);
}

/**
 * Computes and settles a `component()` signal during render and returns its value. If the render
 * suspends, the signal's render lease is pinned, so the relays the suspended render reads stay
 * active for however long React waits to retry it: until the thrown thenable settles, or, for
 * React's `use()`, whose thenable is hidden, until React retries or commits the element (see
 * `holdSuspendedLease`). A render that throws an error keeps an ordinary lease; React does not
 * wait on it.
 *
 * `props` are the props the inner component received. A render of the same user element that
 * starts after earlier mount attempts suspended releases their pins, once it has leased its own.
 */
export function readComponentSignal<T>(signal: ReactiveSignal<T, []>, props: object): T {
  const element = elementPropsByInnerProps.get(props);
  let attempts = element === undefined ? undefined : suspendedAttemptsByElement.get(element);

  try {
    runSignal(signal as ReactiveSignal<any, any[]>);
    const value = signal.value as T;
    attempts?.delete(signal);
    return value;
  } catch (error) {
    let pinned = true;

    if (error !== null && typeof error === 'object' && isThennable(error)) {
      holdLeaseUntilSettled(signal, error);
    } else if (isReactSuspenseException(error)) {
      holdSuspendedLease(signal);
    } else {
      pinned = false;
    }

    if (pinned && element !== undefined && signal._isLeased) {
      if (attempts === undefined) {
        attempts = new Set();
        suspendedAttemptsByElement.set(element, attempts);
      }

      attempts.add(signal);
    }

    throw error;
  } finally {
    if (attempts !== undefined) {
      for (const attempt of attempts) {
        if (attempt !== signal) {
          releaseAbandonedAttempt(attempt);
          attempts.delete(attempt);
        }
      }
    }
  }
}

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
 * `component()`), outer `useMemo` keyed by `hashProps(props)`. No definition-scoped props map.
 */
export function createAsyncComponentWrapper<P extends object>(
  fn: (props: P) => Generator<any, ReactTypes.ReactNode | ReactTypes.ReactNode[] | null, unknown>,
  options?: ReactReaderOptions,
): (props: P) => ReactTypes.ReactNode {
  const deliveryOverride = options?.delivery;

  const Inner = (props: P) => {
    const scope = useScope();
    const manager = usePauseSignalsManager();
    const delivery = useDeliveryMode(deliveryOverride);

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

    // Same ordering as sync `component()`: watch before computing (so relays read during the
    // computation activate), and compute + settle the signal before the snapshot is read so the
    // mount render's snapshot is stable (no forced re-render / sync redo).
    const subscribe = addRenderListener(sig, manager);

    const value = readComponentSignal(sig, props);

    // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
    if (delivery === 'state') {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useStateDelivery(sig, subscribe, sig.updatedCount, manager);
    } else {
      const getSnapshot = () => sig!.updatedCount;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      usePausableStore(manager, sig, subscribe, getSnapshot);
    }

    return value;
  };

  const Outer = (props: P) => {
    const hash = usePropsHash(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => createComponentElement(Inner, props), [hash]);
  };

  Object.defineProperty(Outer, SIGNALIUM_ASYNC_COMPONENT, { value: true, enumerable: false });

  return Outer as (props: P) => ReactTypes.ReactNode;
}
