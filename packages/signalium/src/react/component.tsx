/* eslint-disable react-hooks/rules-of-hooks */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useScope } from './context.js';
import { useSignalsSuspended } from './suspend-signals-context.js';
import { ReactiveSignal, createReactiveDefinition } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { hashValue } from '../internals/utils/hash.js';
import { isReactivePromise, ReactivePromiseImpl } from '../internals/async.js';
import { StateSignal } from '../internals/signal.js';
import { getGlobalScope } from '../internals/contexts.js';

type ComponentReturn = React.ReactNode | React.ReactNode[] | null;

const GENERATOR_FN = function* () {}.constructor;

const PROPS_MAP = new WeakMap<object, any>();

export default function component<Props extends object>(
  fn: (props: Props) => ComponentReturn | Promise<ComponentReturn>,
) {
  const isAsync = fn instanceof GENERATOR_FN;

  const def = createReactiveDefinition<any, []>(
    undefined,
    undefined,
    () => fn(PROPS_MAP.get(def)!),
    () => false,
    false,
    undefined,
    undefined,
  );

  const Component = (props: Props) => {
    const scope = useScope() ?? getGlobalScope();
    const suspended = useSignalsSuspended();

    PROPS_MAP.set(def, props);

    const signal = scope.get(def, []);
    signal._isLazy = true;

    signal.setSuspended(suspended);

    useSyncExternalStore(
      signal.addListenerLazy(),
      () => signal.updatedCount,
      () => signal.updatedCount,
    );

    runSignal(signal as ReactiveSignal<any, any[]>);

    const result = signal.value;

    if (isAsync && result !== null && typeof result === 'object' && isReactivePromise(result as object)) {
      const promise = result as unknown as ReactivePromiseImpl<ComponentReturn>;
      const version = promise['_version'] as StateSignal<number>;

      // Subscribe to async value changes. Uses _updatedCount as snapshot
      // (bumps only on value/error changes) to avoid re-render loops from
      // pending→resolved flag transitions that don't change the value.
      useSyncExternalStore(
        useCallback((onStoreChange: () => void) => version.addListener(onStoreChange), [version]),
        () => promise._updatedCount,
        () => promise._updatedCount,
      );

      if (!promise.isReady) {
        throw promise;
      }

      return promise.value as ComponentReturn;
    }

    return result as ComponentReturn;
  };

  if (isAsync) {
    return Component;
  }

  return (props: Props) => {
    const hash = hashValue(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => <Component {...props} />, [hash]);
  };
}
