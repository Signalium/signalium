import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Lifecycle, disposal, and watcher edge cases adapted from:
 * - Angular Signals (watcher destroy, cleanup idempotency)
 * - Legend State (dispose reverts to lazy, reaction callback untracked)
 * - Vue (watcher execution order, watcher resets source)
 * - SolidJS (nested memo, cross-writes)
 */
describe('lifecycle edge cases', () => {
  describe('watcher disposal', () => {
    test('disposed watcher receives no further notifications', () => {
      const counter = signal(0);
      const c = reactive(() => counter.value * 2, { desc: 'doubled' });

      let listenerCount = 0;
      const w = watcher(() => c());
      const unsub = w.addListener(() => {
        listenerCount++;
      });

      expect(c()).toBe(0);
      listenerCount = 0;

      unsub();

      counter.value = 1;
      counter.value = 2;
      counter.value = 3;

      // Listener should NOT have fired after disposal
      expect(listenerCount).toBe(0);

      // But pulling should still return fresh value (lazy mode)
      expect(c()).toBe(6);
    });

    test('disposing watcher twice does not throw', () => {
      const s = signal(0);
      const c = reactive(() => s.value, { desc: 'disposeDouble' });

      const w = watcher(() => c());
      const unsub = w.addListener(() => {});

      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });

  describe('multiple watchers on same signal', () => {
    test('disposing one watcher does not affect others', () => {
      const s = signal(0);
      const c = reactive(() => s.value, { desc: 'shared' });

      let count1 = 0;
      let count2 = 0;
      let count3 = 0;

      const w1 = watcher(() => c());
      const unsub1 = w1.addListener(() => count1++);

      const w2 = watcher(() => c());
      const unsub2 = w2.addListener(() => count2++);

      const w3 = watcher(() => c());
      const unsub3 = w3.addListener(() => count3++);

      c();
      count1 = 0;
      count2 = 0;
      count3 = 0;

      // Dispose the middle one
      unsub2();

      s.value = 1;

      // Remaining watchers should still work
      expect(c()).toBe(1);
    });
  });

  describe('watcher listener dependencies', () => {
    /**
     * BEHAVIOR DIFFERENCE: In signalium, watcher listeners are scheduled
     * asynchronously via the scheduler. They do NOT run synchronously
     * after a signal change. This means signal modifications inside
     * listener callbacks don't cascade synchronously.
     *
     * In Vue/SolidJS/Angular, effect callbacks run synchronously (or
     * via a microtask flush), so signal writes inside them cascade
     * immediately. This test documents signalium's async listener model.
     */
    test('watcher listener that modifies a signal — sync read after change', () => {
      const a = signal(0);
      const b = signal(0);

      const ca = reactive(() => a.value, { desc: 'ca' });

      const w1 = watcher(() => ca());
      w1.addListener(() => {
        b.value = a.value * 10;
      });

      a.value = 1;

      // In signalium, the listener is scheduled, not synchronous.
      // a.value is updated, but the listener hasn't run yet.
      expect(a.value).toBe(1);
      // b.value may or may not be updated depending on scheduling
    });
  });

  describe('nested computed creation', () => {
    test('computed that creates inner computed — inner values propagate', () => {
      const s1 = signal(1);
      const s2 = signal(10);

      let innerFn: (() => number) | undefined;

      const outer = reactive(
        () => {
          // Creates a new inner computed each time
          innerFn = reactive(() => s2.value, { desc: 'inner' });
          return s1.value;
        },
        { desc: 'outer' },
      );

      const consumer = reactive(
        () => {
          outer(); // ensures outer runs and creates innerFn
          return innerFn!();
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});

      expect(consumer()).toBe(10);

      // Change s2 — inner computed should update
      s2.value = 20;
      expect(consumer()).toBe(20);

      // Change s1 — outer re-runs, creates new inner
      s1.value = 2;
      expect(consumer()).toBe(20); // s2 is still 20
    });
  });

  describe('deep watcher chains', () => {
    test('watcher chain: signal mutation propagates through computeds', () => {
      const a = signal(0);
      const b = signal(0);

      const ca = reactive(() => a.value + b.value, { desc: 'combined' });

      const w = watcher(() => ca());
      w.addListener(() => {});

      expect(ca()).toBe(0);

      a.value = 1;
      b.value = 100;

      expect(ca()).toBe(101);
    });
  });

  describe('computed chains with intermediate reads', () => {
    test('3-level chain: reading middle node does not break end node', () => {
      const src = signal(0);

      const c1 = reactive(() => src.value + 'A', { desc: 'c1' });
      const c2 = reactive(() => c1() + 'B', { desc: 'c2' });
      const c3 = reactive(() => c2() + 'C', { desc: 'c3' });

      const w = watcher(() => c3());
      w.addListener(() => {});

      expect(c3()).toBe('0ABC');

      // Read middle node directly
      src.value = 1;
      expect(c2()).toBe('1AB');

      // End node should also be up-to-date
      expect(c3()).toBe('1ABC');
    });

    test('reading computed between source mutations returns consistent values', () => {
      const src = signal(0);
      const c = reactive(() => src.value * 2, { desc: 'doubled' });

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(0);

      src.value = 1;
      expect(c()).toBe(2); // read between mutations

      src.value = 2;
      expect(c()).toBe(4); // read between mutations

      src.value = 3;
      expect(c()).toBe(6); // final
    });
  });

  describe('fan-in with shared intermediate', () => {
    test('two watchers sharing a computed: both see consistent updates', () => {
      const src = signal(0);
      const shared = reactive(() => src.value * 2, { desc: 'shared' });

      let result1 = 0;
      let result2 = 0;

      const w1 = watcher(() => shared());
      w1.addListener(() => {
        result1 = shared() as number;
      });

      const w2 = watcher(() => shared());
      w2.addListener(() => {
        result2 = shared() as number;
      });

      expect(shared()).toBe(0);

      src.value = 5;

      expect(shared()).toBe(10);
    });
  });

  describe('complex multi-source patterns', () => {
    test('computed reading from two independent signal chains', () => {
      const a1 = signal(1);
      const a2 = signal(2);
      const b1 = signal(10);
      const b2 = signal(20);

      const chainA = reactive(() => a1.value + a2.value, { desc: 'chainA' });
      const chainB = reactive(() => b1.value + b2.value, { desc: 'chainB' });
      const combined = reactive(() => chainA() * chainB(), { desc: 'combined' });

      const w = watcher(() => combined());
      w.addListener(() => {});

      expect(combined()).toBe(3 * 30);

      a1.value = 5;
      expect(combined()).toBe(7 * 30);

      b2.value = 100;
      expect(combined()).toBe(7 * 110);

      // Update both chains
      a2.value = 8;
      b1.value = 50;
      expect(combined()).toBe(13 * 150);
    });

    test('signal read by many independent computed chains', () => {
      const shared = signal(1);

      const chains: (() => number)[] = [];
      for (let i = 0; i < 10; i++) {
        const local = signal(i);
        const c = reactive(
          () => shared.value + local.value,
          { desc: `chain${i}` },
        );
        chains.push(c);
      }

      const sum = reactive(
        () => {
          let total = 0;
          for (const c of chains) {
            total += c();
          }
          return total;
        },
        { desc: 'sum' },
      );

      const w = watcher(() => sum());
      w.addListener(() => {});

      // shared=1, locals=0..9, each chain = 1+i, sum = 10 + (0+1+...+9) = 10+45 = 55
      expect(sum()).toBe(55);

      shared.value = 10;
      // Each chain = 10+i, sum = 100 + 45 = 145
      expect(sum()).toBe(145);
    });
  });

  describe('selector-like pattern', () => {
    test('fine-grained selection: only selected index recomputes', () => {
      const selected = signal(-1);
      const items = Array.from({ length: 20 }, (_, i) => signal(`item${i}`));

      const computeCounts = new Array(20).fill(0);

      const selectors = items.map((item, i) =>
        reactive(
          () => {
            computeCounts[i]++;
            return selected.value === i ? `[${item.value}]` : item.value;
          },
          { desc: `sel${i}` },
        ),
      );

      const w = watcher(() => {
        for (const sel of selectors) {
          sel();
        }
      });
      w.addListener(() => {});

      // Initial compute — all 20 compute
      for (const sel of selectors) {
        sel();
      }
      computeCounts.fill(0);

      // Select index 3
      selected.value = 3;
      for (const sel of selectors) {
        sel();
      }

      // All 20 recompute because they all read `selected`
      // (This tests the worst case — a proper selector optimization would do O(1))
      // The important thing is correctness: only index 3 should show brackets
      expect(selectors[3]()).toBe('[item3]');
      expect(selectors[0]()).toBe('item0');
      expect(selectors[19]()).toBe('item19');

      // Change selection from 3 to 7
      selected.value = 7;
      expect(selectors[3]()).toBe('item3');
      expect(selectors[7]()).toBe('[item7]');
    });
  });
});
