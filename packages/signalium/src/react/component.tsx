import * as React from 'react';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useScope } from './context.js';
import { usePauseSignalsManager } from './pause-signals-context.js';
import { setRequestScopeGetter, SignalScope } from '../internals/contexts.js';
import { createReactiveSignal, ReactiveSignal } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { hashValue } from '../internals/utils/hash.js';
import { createAsyncComponentWrapper } from './async-component.js';
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

export default function component<Props extends object>(
  fn: (props: Props) => Promise<ComponentRender>,
): (props: Props) => ReactNode;
export default function component<Props extends object>(
  fn: (props: Props) => ComponentRender,
): (props: Props) => ReactNode;
export default function component<Props extends object>(
  fn: (props: Props) => ComponentRender | Promise<ComponentRender>,
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
    return createAsyncComponentWrapper(fn as (props: Props) => Generator<any, ComponentRender, unknown>);
  }

  // Async `component(async () => { await ... })` is rewritten to a generator by the Babel preset.
  // Remaining callers are synchronous render functions only (see Promise overload for TS authoring).
  const syncFn = fn as (props: Props) => ComponentRender;

  const Component = (props: Props) => {
    const scope = useScope();
    const manager = usePauseSignalsManager();

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

    const watch = !manager?.paused;
    manager?.register(signal);

    useEffect(() => {
      return () => manager?.unregister(signal!);
    }, [manager, signal]);

    useSyncExternalStore(
      signal.addListenerLazy(watch),
      () => signal.updatedCount,
      () => signal.updatedCount,
    );

    runSignal(signal as ReactiveSignal<any, any[]>);

    return signal.value;
  };

  return (props: Props) => {
    const hash = hashValue(props);
    // Renders Comp only when hash changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => <Component {...props} />, [hash]);
  };
}
