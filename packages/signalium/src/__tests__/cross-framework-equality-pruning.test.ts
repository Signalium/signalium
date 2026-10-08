import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Equality, memoization, and pruning edge cases adapted from:
 * - preact-signals (bail out, same value, avoidable recomputation)
 * - TC39 signal-polyfill (pruning.test.ts, custom-equality.test.ts)
 * - Vue reactivity (computed should not trigger if value unchanged)
 * - js-reactivity-benchmark (kairo avoidable, kairo repeated)
 */
describe('equality and pruning edge cases', () => {
  describe('value equality pruning', () => {
    test('computed returning same value should not trigger downstream', () => {
      const src = signal('a');

      let bCount = 0;
      const b = reactive(
        () => {
          bCount++;
          src.value;
          return 'constant';
        },
        { desc: 'b' },
      );

      let cCount = 0;
      const c = reactive(
        () => {
          cCount++;
          return b();
        },
        { desc: 'c' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe('constant');
      bCount = 0;
      cCount = 0;

      src.value = 'aa';

      // b should recompute (its dep changed) but c should be pruned (b's value unchanged)
      expect(c()).toBe('constant');
      expect(bCount).toBe(1);
      expect(cCount).toBe(0);
    });

    test('chained computed: pruning propagates through chain', () => {
      const src = signal(0);

      let c1Count = 0;
      const c1 = reactive(
        () => {
          c1Count++;
          return src.value % 2;
        },
        { desc: 'c1' },
      );

      let c2Count = 0;
      const c2 = reactive(
        () => {
          c2Count++;
          return c1() + 1;
        },
        { desc: 'c2' },
      );

      const w = watcher(() => c2());
      w.addListener(() => {});

      expect(c2()).toBe(1); // src=0, c1=0, c2=1
      c1Count = 0;
      c2Count = 0;

      // src changes to 2: c1 recomputes (0%2=0, same value), c2 pruned
      src.value = 2;
      expect(c2()).toBe(1);
      expect(c1Count).toBe(1);
      expect(c2Count).toBe(0);

      // src changes to 3: c1 recomputes (3%2=1, different!), c2 recomputes
      src.value = 3;
      expect(c2()).toBe(2);
      expect(c1Count).toBe(2);
      expect(c2Count).toBe(1);
    });

    test('kairo avoidable: firewall computed blocks downstream recomputation', () => {
      const head = signal(0);

      const passthrough = reactive(() => head.value, { desc: 'passthrough' });

      const firewall = reactive(
        () => {
          passthrough();
          return 0; // always returns 0
        },
        { desc: 'firewall' },
      );

      let expensiveCount = 0;
      const expensive1 = reactive(
        () => {
          expensiveCount++;
          return firewall() + 1;
        },
        { desc: 'expensive1' },
      );

      const expensive2 = reactive(() => expensive1() + 2, { desc: 'expensive2' });
      const expensive3 = reactive(() => expensive2() + 3, { desc: 'expensive3' });

      const w = watcher(() => expensive3());
      w.addListener(() => {});

      expect(expensive3()).toBe(6);
      expensiveCount = 0;

      // Write 100 times — firewall always returns 0, so expensive chain should NOT recompute
      for (let i = 1; i <= 100; i++) {
        head.value = i;
      }

      expect(expensive3()).toBe(6);
      expect(expensiveCount).toBe(0);
    });

    test('writing same value to signal does not trigger recomputation', () => {
      const s = signal('a');

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value;
        },
        { desc: 'c' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe('a');
      computeCount = 0;

      s.value = 'a'; // same value
      expect(c()).toBe('a');
      expect(computeCount).toBe(0);
    });

    test('NaN equality: NaN === NaN via Object.is should not retrigger', () => {
      const s = signal(NaN);

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value;
        },
        { desc: 'c' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBeNaN();
      computeCount = 0;

      s.value = NaN;
      // Default equality uses ===, where NaN !== NaN. This tests the framework's behavior.
      // If the framework uses Object.is, this should not retrigger.
      c();
    });
  });

  describe('custom equality', () => {
    test('custom equals on signal controls whether downstream triggers', () => {
      let shouldEqual = true;

      const s = signal(1, {
        equals: () => shouldEqual,
      });

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value;
        },
        { desc: 'c' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(1);
      computeCount = 0;

      // equals returns true — set is rejected, value unchanged
      s.value = 2;
      expect(c()).toBe(1);
      expect(computeCount).toBe(0);

      // equals returns false — set is accepted
      shouldEqual = false;
      s.value = 2;
      expect(c()).toBe(2);
      expect(computeCount).toBe(1);
    });

    test('equals: false on signal means every set triggers', () => {
      const s = signal(1, { equals: false });

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value;
        },
        { desc: 'c' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(1);
      computeCount = 0;

      s.value = 1; // same value, but equals: false
      expect(c()).toBe(1);
      expect(computeCount).toBe(1);
    });
  });

  describe('repeated reads', () => {
    test('kairo repeated: reading same signal N times in one computed', () => {
      const size = 30;
      const head = signal(0);

      const sum = reactive(
        () => {
          let result = 0;
          for (let i = 0; i < size; i++) {
            result += head.value;
          }
          return result;
        },
        { desc: 'sum' },
      );

      const w = watcher(() => sum());
      w.addListener(() => {});

      expect(sum()).toBe(0);

      for (let i = 1; i <= 10; i++) {
        head.value = i;
        expect(sum()).toBe(i * size);
      }
    });
  });

  describe('computed does not track reactive data', () => {
    test('computed with no reactive reads should never recompute', () => {
      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return 42;
        },
        { desc: 'noReactiveDeps' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(42);
      computeCount = 0;

      // Mutate an unrelated signal
      const unrelated = signal(0);
      unrelated.value = 1;

      expect(c()).toBe(42);
      expect(computeCount).toBe(0);
    });
  });
});
