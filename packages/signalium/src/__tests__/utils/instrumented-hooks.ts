import { afterEach, Assertion, expect } from 'vitest';
import {
  reactive as _reactive,
  relay as _relay,
  RelayActivate,
  withContexts,
  task as _task,
  watcher,
} from '../../index.js';
import { ReactiveTask, ReactiveValue, RelayHooks, ReactiveOptions } from '../../types.js';
import { Context, ContextImpl, getCurrentScope, getGlobalScope, SignalScope } from '../../internals/contexts.js';
import { ReactiveFnSignal } from '../../internals/reactive.js';
import { ReactivePromise } from '../../internals/async.js';
import { hashValue } from '../../internals/utils/hash.js';
class SignalHookCounts {
  name: string;

  get = 0;
  set = 0;
  compute = 0;

  resolve = 0;

  subscribe = 0;
  update = 0;
  unsubscribe = 0;
  internalGet = 0;
  internalSet = 0;
  error = 0;

  effect = 0;

  constructor(name: string) {
    this.name = name;
  }
}

const countsKeys = Object.keys(new SignalHookCounts('')).filter(k => k !== 'name') as (keyof SignalHookCounts)[];

let currentOrder: string[] | undefined = [];

type ContextPair<T extends unknown[]> = {
  [K in keyof T]: [Context<T[K]>, NoInfer<T[K]>];
};

interface CustomMatchers<R = unknown> {
  toHaveSignalValue: (v: any) => Assertion<R>;
  toHaveCounts: (counts: Partial<SignalHookCounts>) => Assertion<R>;
  toHaveValueAndCounts: (v: any, counts: Partial<SignalHookCounts>) => Assertion<R>;
  toHaveComputedOrder: (order: string[]) => Assertion<R>;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

let unsubs: (() => void)[] = [];

afterEach(() => {
  unsubs.forEach(unsub => unsub());
});

let TEST_ID = 0;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const WATCHERS = new WeakMap<Function, ReactiveFnSignal<unknown, unknown[]>>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function getWatcherForHook(hook: Function) {
  let w = WATCHERS.get(hook);

  if (!w) {
    w = watcher(
      () => {
        let result = hook();

        if (result instanceof ReactivePromise) {
          result = result.value;
        }

        return result;
      },
      { desc: 'test' + TEST_ID++ },
    ) as ReactiveFnSignal<unknown, unknown[]>;

    unsubs.push(w.addListener(() => {}));

    WATCHERS.set(hook, w);
  }

  return w;
}

function toHaveSignalValue(
  this: { equals(a: unknown, b: unknown): boolean },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  hook: Function,
  value: any,
) {
  if (hook instanceof ReactivePromise) {
    return {
      pass: this.equals(hook.value, value),
      message: () => `Expected relay value to be ${JSON.stringify(value)}, but got ${JSON.stringify(hook.value)}`,
    };
  }

  const signalValue = getWatcherForHook(hook).value;

  return {
    pass: this.equals(signalValue, value),
    message: () => `Expected signal value to be ${value}, but got ${signalValue}`,
  };
}

function toHaveCounts(hook: { [COUNTS]: SignalHookCounts }, counts: SignalHookCounts) {
  const signalCounts = hook[COUNTS];

  if (!signalCounts) {
    return {
      pass: false,
      message: () => 'Signal not found in counts map',
    };
  }

  for (const key of countsKeys) {
    const count = counts[key];

    if (count !== undefined && signalCounts[key] !== count) {
      return {
        pass: false,
        message: () => `Expected ${key} count to be ${count} but got ${signalCounts[key]}`,
      };
    }
  }

  return {
    pass: true,
    message: () => 'Counts match',
  };
}

expect.addSnapshotSerializer({
  serialize(val) {
    const counts = val[COUNTS];
    const value = getWatcherForHook(val).value;

    return JSON.stringify([value, counts], null, 2);
  },
  test(val) {
    return val[COUNTS] !== undefined;
  },
});

expect.extend({
  toHaveSignalValue,
  toHaveCounts,

  toHaveValueAndCounts(signal, value, counts) {
    const valueResult = toHaveSignalValue.call(this, signal, value);
    const countsResult = toHaveCounts.call(this, signal, counts);

    return {
      pass: valueResult.pass && countsResult.pass,
      message: () => {
        const messages = [
          !valueResult.pass && valueResult.message(),
          !countsResult.pass && countsResult.message(),
        ].filter(m => m);

        return messages.join('\n');
      },
    };
  },

  toHaveComputedOrder(fn: () => void, expectedOrder: string[]) {
    const order = (currentOrder = []);

    fn();

    currentOrder = undefined;

    return {
      pass: this.equals(order, expectedOrder),
      message: () => `Expected compute count to be ${expectedOrder.toString()} but got ${order.toString()}`,
    };
  },
});

function getContextKeys(scope: SignalScope): symbol[] {
  const contexts = scope['contexts'];

  const keys = Object.getOwnPropertySymbols(contexts);

  if (scope['parentScope']) {
    return [...getContextKeys(scope['parentScope']), ...keys];
  }

  return keys;
}

function getSortedContexts(scope: SignalScope) {
  const keys = getContextKeys(scope).sort((a, b) => a.toString().localeCompare(b.toString()));

  return keys.map(key => {
    const context = scope['contexts'][key];

    return [key, context];
  });
}

function getCountsFor(name: string, map: Map<number, SignalHookCounts>, scope: SignalScope, args: unknown[] = []) {
  const key = hashValue([args, getSortedContexts(scope)]);
  let countsForArgs = map.get(key);

  if (!countsForArgs) {
    countsForArgs = new SignalHookCounts(name);
    map.set(key, countsForArgs);
  }

  return countsForArgs;
}

const COUNTS = Symbol('counts');

export type RelayWithCounts<T> = ReactivePromise<T> & {
  [COUNTS]: SignalHookCounts;
};

export type TaskWithCounts<T, Args extends unknown[]> = ReactiveTask<T, Args> & {
  [COUNTS]: SignalHookCounts;
};

export type ReactiveFunctionWithCounts<T, Args extends unknown[]> = ((...args: Args) => ReactiveValue<T>) & {
  [COUNTS]: SignalHookCounts;
};

export type ReactiveBuilderFunction<T, Args extends unknown[]> = ((...args: Args) => ReactiveValue<T>) & {
  [COUNTS]: SignalHookCounts;
  watch: () => () => void;
  withParams: (...args: Args) => ReactiveBuilderFunction<T, []>;
  withContexts: (...contexts: [Context<unknown>, unknown][]) => ReactiveBuilderFunction<T, Args>;
};

// Create a function-class hybrid for the builder pattern
function createBuilderFunction<T, Args extends unknown[]>(
  originalFn: (...args: Args) => ReactiveValue<T>,
  countsMap: Map<number, SignalHookCounts>,
  args: Args,
  contexts?: [Context<unknown>, unknown][],
): ReactiveBuilderFunction<T, []>;
function createBuilderFunction<T, Args extends unknown[]>(
  originalFn: (...args: Args) => ReactiveValue<T>,
  countsMap: Map<number, SignalHookCounts>,
  args?: undefined,
  contexts?: [Context<unknown>, unknown][],
): ReactiveBuilderFunction<T, Args>;
function createBuilderFunction<T, Args extends unknown[]>(
  originalFn: (...args: Args) => ReactiveValue<T>,
  countsMap: Map<number, SignalHookCounts>,
  args?: Args,
  contexts?: [Context<unknown>, unknown][],
): ReactiveBuilderFunction<T, Args> {
  // Cast the function to include our additional properties
  const builderFn = ((...passedArgs: Args) => {
    if (args && passedArgs.length > 0) {
      throw new Error('reactive function already has parameters');
    }

    let usedArgs = args ?? passedArgs;

    const scope = getCurrentScope();
    const counts = getCountsFor(originalFn.name, countsMap, scope, usedArgs);

    // increment the get count since each time this is called, we're getting the value
    counts.get++;

    if (contexts) {
      return withContexts(contexts, () => originalFn(...usedArgs));
    }

    return originalFn(...usedArgs);
  }) as ReactiveBuilderFunction<T, Args>;

  // Add the builder methods
  builderFn.watch = (...args: Args) => {
    const unsub = watcher(() => builderFn(...args)).addListener(() => {});
    unsubs.push(unsub);
    return unsub;
  };

  builderFn.withParams = (...withArgs: Args) => {
    if (args) {
      throw new Error('reactive function already has parameters');
    }

    return createBuilderFunction(originalFn, countsMap, withArgs, contexts);
  };

  builderFn.withContexts = (...withContexts: [Context<unknown>, unknown][]) => {
    if (contexts) {
      throw new Error('reactive function already has contexts');
    }

    return createBuilderFunction(originalFn, countsMap, args as Args, withContexts) as ReactiveBuilderFunction<T, Args>;
  };

  const globalScope = getGlobalScope();
  const scope = contexts ? globalScope.getChild(contexts as [ContextImpl<unknown>, unknown][]) : globalScope;
  builderFn[COUNTS] = getCountsFor(originalFn.name, countsMap, scope, args);

  return builderFn;
}

export function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): ReactiveBuilderFunction<T, Args> {
  const countsMap = new Map<number, SignalHookCounts>();

  return createBuilderFunction(
    _reactive((...args: any[]) => {
      const scope = getCurrentScope();
      const counts = getCountsFor(opts?.desc ?? 'unknownReactive', countsMap, scope, args);

      counts.compute++;

      return fn(...(args as any));
    }, opts) as ReactiveFunctionWithCounts<T, Args>,
    countsMap,
  );
}

export const task: typeof _task = (fn, opts) => {
  const counts = new SignalHookCounts(opts?.desc ?? 'unknownTask');

  const wrapper = _task((...args: any[]) => {
    counts.compute++;

    return fn(...(args as any));
  }, opts) as TaskWithCounts<any, any>;

  wrapper[COUNTS] = counts;

  return wrapper;
};

export const relay = <T>(fn: RelayActivate<T>, opts?: ReactiveOptions<T, unknown[]>): ReturnType<typeof _relay<T>> => {
  const counts = new SignalHookCounts(opts?.desc ?? 'unknownRelay');

  let wrapper = _relay<T>(state => {
    counts.subscribe++;
    counts.compute++;

    const result = fn({
      get value() {
        counts.internalGet++;
        return state.value;
      },

      set value(v) {
        counts.internalSet++;
        state.value = v;
      },

      setPromise: (promise: Promise<T>) => {
        counts.internalSet++;
        state.setPromise(promise);
      },

      setError: (error: unknown) => {
        counts.error++;
        state.setError(error);
      },
    });

    let relayWrapper: RelayHooks | (() => unknown) | undefined;

    if (result) {
      if (typeof result === 'function') {
        relayWrapper = () => {
          counts.unsubscribe++;
          result();
        };
      } else {
        relayWrapper = {};

        if (result.deactivate) {
          relayWrapper.deactivate = () => {
            counts.unsubscribe++;
            result.deactivate!();
          };
        }

        if (result.update) {
          relayWrapper.update = () => {
            counts.compute++;
            counts.update++;
            result.update!();
          };
        }
      }
    }

    return relayWrapper;
  }, opts) as RelayWithCounts<T>;

  wrapper[COUNTS] = counts;

  return wrapper as ReturnType<typeof _relay<T>>;
};
