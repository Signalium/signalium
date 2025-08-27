import {
  TaskSignal,
  SignalValue,
  ReadyAsyncSignal as ReadyAsyncSignal,
  ReadySignalValue,
  ReadonlySignal,
  SignalOptions,
  SignalActivate,
  type SignalOptionsWithInit,
} from './types.js';
import { getCurrentScope, getOwner, SignalScope } from './internals/contexts.js';
import { createReactiveFnSignal, ReactiveFnDefinition } from './internals/reactive.js';
import { AsyncSignalImpl } from './internals/async.js';
import { Tracer } from './trace.js';
import { equalsFrom } from './internals/utils/equals.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const DERIVED_DEFINITION_MAP = new Map<Function, ReactiveFnDefinition<any, any>>();

export function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: Partial<SignalOptionsWithInit<T, Args>>,
): (...args: Args) => SignalValue<T>;
export function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts: SignalOptionsWithInit<T, Args>,
): (...args: Args) => ReadySignalValue<T>;
export function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: Partial<SignalOptionsWithInit<T, Args>>,
): (...args: Args) => SignalValue<T> {
  const def: ReactiveFnDefinition<T, Args> = {
    compute: fn,
    equals: equalsFrom(opts?.equals),
    isRelay: false,
    id: opts?.id,
    desc: opts?.desc,
    paramKey: opts?.paramKey,
    shouldGC: opts?.shouldGC,
    initValue: opts?.initValue,
  };

  const reactiveFn: (...args: Args) => SignalValue<T> = (...args) => {
    const scope = getCurrentScope();
    const signal = scope.get(def, args);

    return signal.value;
  };

  DERIVED_DEFINITION_MAP.set(reactiveFn, def);

  return reactiveFn;
}

export const reactiveMethod = <T, Args extends unknown[]>(
  owner: object,
  fn: (...args: Args) => T,
  opts?: Partial<SignalOptionsWithInit<T, Args>>,
): ((...args: Args) => SignalValue<T>) => {
  const def: ReactiveFnDefinition<T, Args> = {
    compute: fn,
    equals: equalsFrom(opts?.equals),
    isRelay: false,
    id: opts?.id,
    desc: opts?.desc,
    paramKey: opts?.paramKey,
    shouldGC: opts?.shouldGC,
    initValue: opts?.initValue,
  };

  const reactiveFn: (...args: Args) => SignalValue<T> = (...args) => {
    const scope = getOwner(owner);

    if (scope === undefined) {
      throw new Error('reactiveMethods must be attached to an owned context object');
    }

    const signal = scope.get(def, args);

    return signal.value;
  };

  DERIVED_DEFINITION_MAP.set(reactiveFn, def);

  return reactiveFn;
};

export function relay<T>(activate: SignalActivate<T>, opts?: SignalOptions<T, unknown[]>): AsyncSignalImpl<T>;
export function relay<T>(activate: SignalActivate<T>, opts: SignalOptionsWithInit<T, unknown[]>): ReadyAsyncSignal<T>;
export function relay<T>(
  activate: SignalActivate<T>,
  opts?: Partial<SignalOptionsWithInit<T, unknown[]>>,
): AsyncSignalImpl<T> | ReadyAsyncSignal<T> {
  const scope = getCurrentScope();

  return AsyncSignalImpl.createRelay(activate, scope, opts);
}

export const task = <T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  opts?: Partial<SignalOptionsWithInit<T, Args>>,
): TaskSignal<T, Args> => {
  const scope = getCurrentScope();

  return AsyncSignalImpl.createTask(fn, scope, opts);
};

export function watcher<T>(
  fn: () => T,
  opts?: SignalOptions<T, unknown[]> & { scope?: SignalScope; tracer?: Tracer },
): ReadonlySignal<SignalValue<T>> & {
  addListener(listener: () => void): () => void;
} {
  const def: ReactiveFnDefinition<T, unknown[]> = {
    compute: fn,
    equals: equalsFrom(opts?.equals),
    isRelay: false,
    id: opts?.id,
    desc: opts?.desc,
    paramKey: opts?.paramKey,
    shouldGC: opts?.shouldGC,
    tracer: opts?.tracer,
  };

  return createReactiveFnSignal(def, undefined, undefined, opts?.scope);
}
