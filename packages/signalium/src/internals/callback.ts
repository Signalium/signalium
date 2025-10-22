import { getCurrentConsumer } from './consumer.js';
import { getCurrentScope, getInternalCurrentScope, setCurrentScope, SignalScope } from './contexts.js';
import { generatorResultToPromiseWithScope } from './generators.js';
import { isGeneratorResult } from './utils/type-utils.js';

let CURRENT_CALLBACK: Callback | undefined = undefined;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export class Callback<T extends Function = Function> {
  scope: SignalScope;
  deps: unknown[] | undefined;
  _callbacks: Callback[] | undefined;
  fn!: T;

  constructor(fn: T, scope: SignalScope, deps?: unknown[]) {
    this.deps = deps;
    this.scope = scope;

    this.setFn(fn);
  }

  get callbacks() {
    return this._callbacks ?? (this._callbacks = []);
  }

  setFn(fn: T) {
    this.fn = ((...args: unknown[]) => {
      const scope = this.scope;
      const prevScope = getInternalCurrentScope();
      const prevCallback = CURRENT_CALLBACK;

      try {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        CURRENT_CALLBACK = this;
        setCurrentScope(scope);

        const result = fn(...args);

        return typeof result === 'object' && result !== null && isGeneratorResult(result)
          ? generatorResultToPromiseWithScope(result, scope)
          : result;
      } finally {
        CURRENT_CALLBACK = prevCallback;
        setCurrentScope(prevScope);
      }
    }) as unknown as T;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function createCallback<T extends Function>(
  fn: T,
  scope: SignalScope,
  deps?: unknown[] | undefined,
): Callback<T> {
  return new Callback(fn, scope, deps);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function callback<T extends Function>(fn: T, idx: number, deps?: unknown[] | undefined): T {
  let callbacks: Callback[];

  if (CURRENT_CALLBACK !== undefined) {
    callbacks = CURRENT_CALLBACK.callbacks;
  } else {
    const currentConsumer = getCurrentConsumer();
    if (currentConsumer === undefined) {
      throw new Error('callback must be used within a reactive function, component, or nested callback');
    }

    callbacks = currentConsumer.callbacks ?? (currentConsumer.callbacks = []);
  }

  let callback = callbacks[idx];

  if (callback === undefined) {
    callback = callbacks[idx] = createCallback(fn, getCurrentScope(), deps);
  } else if (deps && callback.deps?.findIndex((dep, i) => dep !== deps[i]) !== -1) {
    callback.setFn(fn);
    callback.deps = deps as unknown[];
  }

  return callback.fn as T;
}
