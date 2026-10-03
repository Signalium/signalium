import * as React from 'react';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useScope } from './context.js';
import { usePauseSignalsManager } from './pause-signals-context.js';
import { setRequestScopeGetter, SignalScope } from '../internals/contexts.js';
import { createReactiveSignal, ReactiveSignal } from '../internals/reactive.js';
import { usePropsHash } from './props-hash.js';
import { useDeliveryMode, useStateDelivery, type ReactReaderOptions } from './delivery.js';
import { createAsyncComponentWrapper, createComponentElement, readComponentSignal } from './async-component.js';
import {
  type ComponentRender,
  isAsyncFunctionWithoutTransform,
  isGeneratorFunction,
  createServerAsyncComponentWrapper,
} from './component-shared.js';

export {
  isAsyncFunctionWithoutTransform,
  runSyncReplayAsyncComponent,
  SIGNALIUM_ASYNC_COMPONENT,
  throwIfSignaliumAsyncComponentPassedToUse,
} from './async-component.js';

type CacheFn = <T extends (...args: never[]) => unknown>(fn: T) => T;

/**
 * Auto-install per-request scoping for SSR of client components.
 *
 * `setupRscRequestScope()` only affects the RSC bundle; Next.js (and similar frameworks) render
 * client components in a separate SSR module graph. This ensures the SSR bundle also gets a
 * fresh {@link SignalScope} per render via `React.cache` (React 19+).
 */
let _ssrScopeInitialized = false;

function ensureSsrScope(): void {
  if (_ssrScopeInitialized || typeof window !== 'undefined') return;
  _ssrScopeInitialized = true;
  const cache = (React as typeof React & { cache?: CacheFn }).cache;
  if (typeof cache === 'function') {
    const getScope = cache(() => new SignalScope([]));
    setRequestScopeGetter(() => getScope());
  }
}

/** Options for `component()`. */
export type ComponentOptions = ReactReaderOptions;

export default function component<Props extends object>(
  fn: (props: Props) => Promise<ComponentRender>,
  options?: ComponentOptions,
): (props: Props) => ReactNode;
export default function component<Props extends object>(
  fn: (props: Props) => ComponentRender,
  options?: ComponentOptions,
): (props: Props) => ReactNode;
export default function component<Props extends object>(
  fn: (props: Props) => ComponentRender | Promise<ComponentRender>,
  options?: ComponentOptions,
): (props: Props) => ReactNode {
  ensureSsrScope();

  if (isAsyncFunctionWithoutTransform(fn)) {
    throw new Error(
      'signalium: `component(async (props) => { await ... })` requires the Signalium Babel preset (async transform).',
    );
  }

  if (isGeneratorFunction(fn)) {
    if (typeof window === 'undefined') {
      return createServerAsyncComponentWrapper(
        fn as (props: Props) => Generator<any, ComponentRender, unknown>,
      ) as unknown as (props: Props) => ReactNode;
    }
    return createAsyncComponentWrapper(fn as (props: Props) => Generator<any, ComponentRender, unknown>, options);
  }

  // Async `component(async () => { await ... })` is rewritten to a generator by the Babel preset.
  // Remaining callers are synchronous render functions only (see Promise overload for TS authoring).
  const syncFn = fn as (props: Props) => ComponentRender;
  const deliveryOverride = options?.delivery;

  const Component = (props: Props) => {
    const scope = useScope();
    const manager = usePauseSignalsManager();
    const delivery = useDeliveryMode(deliveryOverride);

    const fnSignalRef = useRef<ReactiveSignal<ComponentRender, []> | undefined>(undefined);
    const propsRef = useRef<Props>(props);

    propsRef.current = props;

    let signal = fnSignalRef.current;

    if (signal === undefined) {
      const created = createReactiveSignal(
        {
          compute: () => syncFn(propsRef.current),
          equals: () => false,
          isRelay: false,
          tracer: undefined,
        },
        [],
        undefined,
        scope,
      );
      created._isLazy = true;
      fnSignalRef.current = signal = created;
    }

    // Mark the signal as a listener (and watch it unless paused) before computing, so relays read
    // during the computation are activated.
    const subscribe = signal.addListenerLazy(!manager?.paused);

    // Compute and settle the signal BEFORE `useSyncExternalStore` reads the snapshot. Reading
    // `value` runs `checkSignal`, which bumps `updatedCount` when the lazy signal was dirty (always
    // the case on mount). If the snapshot were read first, React would see it change after render
    // and re-render: synchronously after every mount, and as a sync redo of mounts inside a
    // transition.
    const value = readComponentSignal(signal, props);

    // The delivery mode is fixed for the lifetime of the instance, so the hook order is stable.
    if (delivery === 'state') {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useStateDelivery(signal, subscribe, signal.updatedCount);
    } else {
      const getSnapshot = () => signal.updatedCount;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    // Register with the pause manager on commit (after the store subscription), so renders React
    // discards never register, and StrictMode's effect replay re-registers.
    useEffect(() => {
      if (manager === null) return;
      manager.register(signal);
      return () => manager.unregister(signal);
    }, [manager, signal]);

    return value;
  };

  return (props: Props) => {
    const hash = usePropsHash(props);
    // Renders Comp only when hash changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => createComponentElement(Component, props), [hash]);
  };
}
