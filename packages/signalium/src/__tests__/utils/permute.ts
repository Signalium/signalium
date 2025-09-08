import { describe } from 'vitest';
import { ReactiveBuilderFunction, reactive, relay } from './instrumented-hooks.js';
import { ReactiveOptions } from '../../types.js';

const createMethods = [
  {
    name: 'createComputed',
    create: reactive,
  },
  {
    name: 'createAsyncComputed',
    create: <T, Args extends unknown[]>(
      fn: (...args: Args) => T | Promise<T>,
      opts?: ReactiveOptions<Promise<T>, Args>,
    ): ReactiveBuilderFunction<T, Args> => {
      const computed = reactive(async (...args: Args) => {
        return fn(...args);
      }, opts);

      return reactive((...args: Args) => {
        return computed(...args).value as T;
      });
    },
  },
  {
    name: 'createRelay',
    create: function _createRelay<T, Args extends unknown[]>(
      fn: (...args: Args) => T,
      opts?: ReactiveOptions<T, Args>,
    ): ReactiveBuilderFunction<T, Args> {
      const computed = reactive((...args: Args) => {
        return relay(
          state => {
            const value = fn(...args);

            if (value instanceof Promise) {
              state.setPromise(value);
            } else {
              state.value = value;
            }

            return {
              update: () => {
                const value = fn(...args);

                if (value instanceof Promise) {
                  state.setPromise(value);
                } else {
                  state.value = value;
                }
              },
            };
          },
          opts as ReactiveOptions<T, unknown[]>,
        );
      });

      return reactive((...args: Args) => {
        return computed(...args).value as T;
      }, opts);
    },
  },
];

function generatePermutations(n: number, m: number): number[][] {
  const results: number[][] = [];

  function generate(current: number[], remaining: number) {
    if (remaining === 0) {
      results.push([...current]);
      return;
    }

    for (let i = 0; i < n; i++) {
      current.push(i);
      generate(current, remaining - 1);
      current.pop();
    }
  }

  generate([], m);
  return results;
}

type CreateMethod = (typeof createMethods)[number]['create'];

export function permute(m: number, fn: (...args: CreateMethod[]) => void) {
  const testCases = generatePermutations(createMethods.length, m);

  for (const testCase of testCases) {
    const testMethods = [createMethods[testCase[0]], ...testCase.slice(1).map(i => createMethods[i])];

    describe(`${testMethods.map(m => m.name).join(', ')}`, () => {
      fn(...testMethods.map(m => m.create));
    });
  }
}
