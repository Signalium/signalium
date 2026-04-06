/**
 * Shared helpers for `component()` — used by both the client entry (`component.tsx`)
 * and the server entry (`component-server.ts`). No React hook imports so it's safe
 * for the `react-server` bundle condition.
 */
import type { ReactNode } from 'react';
import { getCurrentConsumer, setCurrentConsumer } from '../internals/consumer.js';
import { getCurrentScope } from '../internals/contexts.js';
import { createReactiveSignal } from '../internals/reactive.js';
import { generatorResultToPromiseWithConsumer } from '../internals/generators.js';

export type ComponentRender = ReactNode | ReactNode[] | null;

export function isGeneratorFunction(fn: unknown): fn is (props: never) => Generator<any, ComponentRender, unknown> {
  return (
    typeof fn === 'function' && (fn as { constructor?: { name?: string } }).constructor?.name === 'GeneratorFunction'
  );
}

export function isAsyncFunctionWithoutTransform(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as { constructor?: { name?: string } }).constructor?.name === 'AsyncFunction';
}

/**
 * Wrap a Babel-transformed async generator in a real `async function` that drives it
 * with {@link generatorResultToPromiseWithConsumer}. Used on the server (RSC + SSR)
 * where hooks-based Suspense replay is not appropriate.
 */
export function createServerAsyncComponentWrapper<P extends object>(
  fn: (props: P) => Generator<any, ComponentRender, unknown>,
): (props: P) => Promise<ComponentRender> {
  return async function (props: P): Promise<ComponentRender> {
    const scope = getCurrentScope();
    const owned = createReactiveSignal<ComponentRender, []>(
      { compute: () => null, equals: () => true, isRelay: false, tracer: undefined },
      [],
      undefined,
      scope,
    );
    return generatorResultToPromiseWithConsumer(fn(props), owned);
  };
}

/**
 * Wrap a sync render function with consumer/scope tracking. Used by the server
 * `component()` for non-generator definitions.
 */
export function createServerSyncComponentWrapper<P extends object>(
  fn: (props: P) => ComponentRender,
): (props: P) => ComponentRender {
  return function (props: P): ComponentRender {
    const scope = getCurrentScope();
    const owned = createReactiveSignal<ComponentRender, []>(
      { compute: () => null, equals: () => true, isRelay: false, tracer: undefined },
      [],
      undefined,
      scope,
    );
    const prevConsumer = getCurrentConsumer();
    try {
      setCurrentConsumer(owned);
      return fn(props);
    } finally {
      setCurrentConsumer(prevConsumer);
    }
  };
}
