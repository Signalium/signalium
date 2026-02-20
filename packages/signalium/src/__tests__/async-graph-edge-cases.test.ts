import { describe, expect, test } from 'vitest';
import { signal, watcher, watchOnce } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

describe('async graph edge cases', () => {
  test('should not double dirty consumers when awaiting a pending signal (causes an infinite loop)', async () => {
    const state = signal(1);

    const inner = reactive(
      async () => {
        const a = state.value;
        await nextTick();
        return a;
      },
      { desc: 'inner' },
    );

    const middle = reactive(
      async () => {
        await sleep(10);
        return await inner();
      },
      { desc: 'outer1' },
    );

    const outer = reactive(
      async () => {
        const a = await middle();
        return a;
      },
      { desc: 'outer2' },
    );

    await watchOnce(async () => {
      await outer();

      state.value = 2;

      const secondPromise = outer();

      state.value = 3;

      outer();

      const output = await secondPromise;
      expect(output).toBe(3);
    });
  });

  describe('immediate read after sequential writes', () => {
    test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
      'with %i level(s) of nesting, outer awaits inner and reflects sequential writes immediately',
      async (levels: number) => {
        const animals = signal<string[]>([]);

        // Create the base reactive function that reads from the signal
        const reactiveFunctions: Array<() => Promise<string[]>> = [];

        reactiveFunctions.push(
          reactive(
            async () => {
              // Introduce an async boundary that resolves next microtask
              const s = animals.value;
              await nextTick();
              return s;
            },
            { desc: 'getRaw0' },
          ),
        );

        // Create the chain of reactive functions up to the desired level
        for (let i = 1; i < levels; i++) {
          const prevFunction = reactiveFunctions[i - 1];
          reactiveFunctions.push(
            reactive(
              async () => {
                const s = await prevFunction();
                return s;
              },
              { desc: `getRaw${i}` },
            ),
          );
        }

        // Use the outermost function in the chain
        const getOutermost = reactiveFunctions[reactiveFunctions.length - 1];

        const write = (k: string) => {
          const curr = animals.value;
          animals.value = [...curr, k];
        };

        // 1) first write
        write('cat');
        let items = await getOutermost();
        expect(items).toContain('cat');

        // 2) second write
        write('dog');
        items = await getOutermost();
        expect(items).toContain('dog');

        // 3) third write — this has been observed to intermittently fail
        write('fish');
        items = await getOutermost();
        expect(items).toContain('fish');
      },
    );
  });
});
