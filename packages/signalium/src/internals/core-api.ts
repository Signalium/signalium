import {
  ReactiveTask,
  ReactiveValue,
  Watcher,
  ReactiveOptions,
  RelayActivate,
  type DiscriminatedReactivePromise,
  SignalOptions,
  ReactiveFn,
} from '../types.js';
import { getCurrentScope, getOwner, SignalScope } from './contexts.js';
import { createReactiveFnSignal, ReactiveFnDefinition } from './reactive.js';
import { createRelay, createTask, ReactivePromise as ReactivePromiseClass } from './async.js';
import { Tracer } from './trace.js';
import { equalsFrom } from './utils/equals.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const DERIVED_DEFINITION_MAP = new Map<Function, [(...args: any) => any, ReactiveFnDefinition<any, any>]>();

export function getReactiveFnAndDefinition<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): [(...args: Args) => ReactiveValue<T>, ReactiveFnDefinition<T, Args>] {
  let fnAndDef = DERIVED_DEFINITION_MAP.get(fn);

  if (!fnAndDef) {
    const def: ReactiveFnDefinition<T, Args> = {
      compute: fn,
      equals: equalsFrom(opts?.equals),
      isRelay: false,
      id: opts?.id,
      desc: opts?.desc,
      paramKey: opts?.paramKey,
      tracer: undefined,
    };

    const reactiveFn: ReactiveFn<T, Args> = (...args) => {
      const scope = getCurrentScope();
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
  const def: ReactiveFnDefinition<T, Args> = {
    compute: fn,
    equals: equalsFrom(opts?.equals),
    isRelay: false,
    id: opts?.id,
    desc: opts?.desc,
    paramKey: opts?.paramKey,
    tracer: undefined,
  };

  const reactiveFn: ReactiveFn<T, Args> = (...args) => {
    const scope = getOwner(owner);

    if (scope === undefined) {
      throw new Error('reactiveMethods must be attached to an owned context object');
    }

    const signal = scope.get(def, args as any);

    return signal.value;
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
  const def: ReactiveFnDefinition<T, unknown[]> = {
    compute: fn,
    equals: equalsFrom(opts?.equals),
    isRelay: false,
    id: opts?.id,
    desc: opts?.desc,
    paramKey: undefined,
    tracer: opts?.tracer,
  };

  const scope = opts?.isolate ? new SignalScope([]) : getCurrentScope();

  return createReactiveFnSignal(def, undefined, undefined, scope);
}
