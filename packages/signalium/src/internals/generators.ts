import { isReactivePromise } from './async.js';
import { getCurrentConsumer, setCurrentConsumer } from './consumer.js';
import { getInternalCurrentScope, setCurrentScope, SignalScope } from './contexts.js';
import { ReactiveSignal } from './reactive.js';
import { isPromise } from './utils/type-utils.js';

export function generatorResultToPromiseWithConsumer<T>(
  generator: Generator<any, T>,
  savedConsumer: ReactiveSignal<any, any> | undefined,
): Promise<T> {
  function adopt(value: any) {
    return typeof value === 'object' && value !== null && (isPromise(value) || isReactivePromise(value))
      ? value
      : Promise.resolve(value);
  }

  return new Promise((resolve, reject) => {
    function step(fn: (value: any) => IteratorResult<any, any>, value?: any) {
      const prevConsumer = getCurrentConsumer();

      try {
        setCurrentConsumer(savedConsumer);
        const result = fn(value);
        if (result.done) {
          resolve(result.value);
        } else {
          adopt(result.value).then(fulfilled, rejected);
        }
      } catch (e) {
        reject(e);
      } finally {
        setCurrentConsumer(prevConsumer);
      }
    }

    const nextFn = generator.next.bind(generator);
    const throwFn = generator.throw.bind(generator);

    function fulfilled(value: any) {
      step(nextFn, value);
    }

    function rejected(value: any) {
      step(throwFn, value);
    }

    step(nextFn);
  });
}

export function generatorResultToPromiseWithScope<T, Args extends unknown[]>(
  generator: Generator<any, T>,
  savedScope: SignalScope | undefined,
): Promise<T> {
  function adopt(value: any) {
    return typeof value === 'object' && value !== null && (isPromise(value) || isReactivePromise(value))
      ? value
      : Promise.resolve(value);
  }

  return new Promise((resolve, reject) => {
    function step(fn: (value: any) => IteratorResult<any, any>, value?: any) {
      const prevScope = getInternalCurrentScope();

      try {
        setCurrentScope(savedScope);
        const result = fn(value);
        if (result.done) {
          resolve(result.value);
        } else {
          adopt(result.value).then(fulfilled, rejected);
        }
      } catch (e) {
        reject(e);
      } finally {
        setCurrentScope(prevScope);
      }
    }

    const nextFn = generator.next.bind(generator);
    const throwFn = generator.throw.bind(generator);

    function fulfilled(value: any) {
      step(nextFn, value);
    }

    function rejected(value: any) {
      step(throwFn, value);
    }

    step(nextFn);
  });
}
