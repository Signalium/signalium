import {
  ReactiveTask,
  ReactiveValue,
  Watcher,
  ReactiveOptions,
  RelayActivate,
  type DiscriminatedReactivePromise,
  SignalOptions,
  ReactiveFn,
  ReadonlySignal,
} from '../types.js';
import { getCurrentScope, getScopeOwner, SignalScope } from './contexts.js';
import {
  createReactiveDefinition,
  createReactiveSignal,
  ReactiveDefinition as ReactiveDefinition,
} from './reactive.js';
import { createRelay, createTask, ReactivePromise as ReactivePromiseClass } from './async.js';
import { Tracer } from './trace.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const DERIVED_DEFINITION_MAP = new Map<Function, [(...args: any) => any, ReactiveDefinition<any, any>]>();

export function getReactiveFnAndDefinition<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): [(...args: Args) => ReactiveValue<T>, ReactiveDefinition<T, Args>] {
  let fnAndDef = DERIVED_DEFINITION_MAP.get(fn);

  if (!fnAndDef) {
    const def = createReactiveDefinition(opts?.id, opts?.desc, fn, opts?.equals, false, opts?.paramKey, undefined);

    const defScope = getCurrentScope();

    const reactiveFn: ReactiveFn<T, Args> = (...args) => {
      const scope = getCurrentScope(defScope);
      const signal = scope.get(def, args as any);

      return signal.value;
    };

    fnAndDef = [reactiveFn, def];

    DERIVED_DEFINITION_MAP.set(fn, fnAndDef);
  }

  return fnAndDef;
}

export function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): ReactiveFn<T, Args> {
  return getReactiveFnAndDefinition(fn, opts)[0];
}

export const reactiveMethod = <T, Args extends unknown[]>(
  owner: object,
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): ReactiveFn<T, Args> => {
  const def = createReactiveDefinition(opts?.id, opts?.desc, fn, opts?.equals, false, opts?.paramKey, undefined);

  const reactiveFn: ReactiveFn<T, Args> = (...args) => {
    return getScopeOwner(owner).get(def, args as any).value;
  };

  DERIVED_DEFINITION_MAP.set(reactiveFn, [reactiveFn, def]);

  return reactiveFn;
};

export function relay<T>(activate: RelayActivate<T>, opts?: SignalOptions<T>): DiscriminatedReactivePromise<T> {
  const scope = getCurrentScope();

  return createRelay(activate, scope, opts) as DiscriminatedReactivePromise<T>;
}

export const task = <T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  opts?: SignalOptions<T>,
): ReactiveTask<T, Args> => {
  const scope = getCurrentScope();

  return createTask(fn, scope, opts);
};

export function watcher<T>(fn: () => T, opts?: SignalOptions<T> & { isolate?: boolean; tracer?: Tracer }): Watcher<T> {
  const def = createReactiveDefinition(opts?.id, opts?.desc, fn, opts?.equals, false, undefined, opts?.tracer);

  const scope = opts?.isolate ? new SignalScope([]) : getCurrentScope();

  return createReactiveSignal(def, undefined, undefined, scope);
}

/**
 * Creates a reactive signal from a compute function. This is useful for when you
 * want to create a signal that does not receive parameters, but is still reactive.
 *
 * @param compute
 * @param opts
 * @returns
 */
export const reactiveSignal = <T>(
  compute: () => T,
  opts?: SignalOptions<T> & { isolate?: boolean },
): ReadonlySignal<T> => {
  const def = createReactiveDefinition(opts?.id, opts?.desc, compute, opts?.equals, false, undefined, undefined);

  const scope = opts?.isolate ? new SignalScope([]) : getCurrentScope();

  return createReactiveSignal(def, undefined, undefined, scope);
};
