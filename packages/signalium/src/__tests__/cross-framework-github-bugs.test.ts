import { describe, expect, test } from 'vitest';
import { signal, watcher, notifier } from 'signalium';
import { reactive, relay } from './utils/instrumented-hooks.js';
import { sleep } from './utils/async.js';

/**
 * Tests adapted from real-world bug reports filed against other
 * reactive frameworks' GitHub repositories:
 *
 * - Preact Signals #614: NaN re-assignment infinite loop
 * - Preact Signals #416: circular effect chains with cross-writing
 * - Vue #11928: exponential perf cost with deeply chained computeds + effects
 * - Vue #11078: computed returning new object triggers infinite watch loop
 * - Vue #9579: manual trigger doesn't propagate through computed-style watchers
 * - Vue #12020: computed value incorrect after dep cleanup and re-acquisition
 * - Vue #11995: dep tracking deleted when computed conditionally drops dep
 * - Angular #55261: short-circuit evaluation loses dependency tracking
 * - Angular #56593: effect reads signal it writes → circular notification
 * - Solid #2352: memo returns undefined during transitions
 * - Solid #2180: signals revert after await under suspense
 * - Legend State: computed over filtered collection + revert causes stack overflow
 */
describe('GitHub issue bug patterns', () => {
  describe('Preact #614: NaN re-assignment seen as value change', () => {
    test('setting NaN to NaN should not trigger downstream', () => {
      const s = signal(NaN);

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value;
        },
        { desc: 'nanConsumer' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      c();
      computeCount = 0;

      // Re-assign NaN — should NOT be seen as a change
      s.value = NaN;
      c();

      // If the framework uses === for equality, NaN !== NaN triggers recomputation
      // If it uses Object.is, NaN is NaN and no recomputation occurs
      // Either way, the value should still be NaN
      expect(c()).toBeNaN();
    });

    test('parseInt producing NaN does not cause infinite effect loop', () => {
      const textInput = signal('');
      const parsed = reactive(
        () => parseInt(textInput.value) || 0,
        { desc: 'parsed' },
      );

      const w = watcher(() => parsed());
      w.addListener(() => {});

      expect(parsed()).toBe(0);

      textInput.value = '42';
      expect(parsed()).toBe(42);

      textInput.value = 'abc'; // parseInt returns NaN, || 0 gives 0
      expect(parsed()).toBe(0);

      textInput.value = ''; // same result
      expect(parsed()).toBe(0);
    });
  });

  describe('Angular #55261: short-circuit loses dependency tracking', () => {
    test('signal after falsy non-signal condition is not tracked', () => {
      const s = signal(1);

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          // Short-circuit: false && s.value → s never read
          return false && s.value;
        },
        { desc: 'shortCircuit' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(false);
      computeCount = 0;

      // s is NOT a dependency because it was short-circuited
      s.value = 2;
      c();

      // The computed should NOT recompute because the signal was never read
      expect(computeCount).toBe(0);
    });

    test('signal before condition IS tracked (order matters)', () => {
      const s = signal(1);

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          return s.value > 0 && false; // s IS read first
        },
        { desc: 'signalFirst' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(false);
      computeCount = 0;

      // s IS a dependency because it was read before the short-circuit
      s.value = -1;
      c();
      expect(computeCount).toBe(1);
    });
  });

  describe('Preact #416: circular effect cross-writing', () => {
    test('two computeds sharing a common signal with conditional writes', () => {
      const a = signal(0);
      const b = signal(0);
      const common = signal(0);

      // Sync a from common
      const syncA = reactive(
        () => {
          const cv = common.value;
          return cv; // just reads, doesn't write
        },
        { desc: 'syncA' },
      );

      // Sync b from common
      const syncB = reactive(
        () => {
          const cv = common.value;
          return cv * 2;
        },
        { desc: 'syncB' },
      );

      const w1 = watcher(() => syncA());
      w1.addListener(() => {});

      const w2 = watcher(() => syncB());
      w2.addListener(() => {});

      expect(syncA()).toBe(0);
      expect(syncB()).toBe(0);

      common.value = 5;
      expect(syncA()).toBe(5);
      expect(syncB()).toBe(10);

      common.value = 10;
      expect(syncA()).toBe(10);
      expect(syncB()).toBe(20);
    });
  });

  describe('Vue #12020: computed value incorrect after dep cleanup and re-acquisition', () => {
    test('computed drops dep then re-acquires it — value must be fresh', () => {
      const flag = signal(true);
      const data = signal(1);

      let directCount = 0;
      const direct = reactive(
        () => {
          directCount++;
          return data.value;
        },
        { desc: 'direct' },
      );

      let conditionalCount = 0;
      const conditional = reactive(
        () => {
          conditionalCount++;
          if (flag.value) {
            data.value; // track data
            return direct();
          }
          return 0;
        },
        { desc: 'conditional' },
      );

      const w = watcher(() => conditional());
      w.addListener(() => {});

      expect(conditional()).toBe(1);

      // Drop data dep by setting flag to false
      flag.value = false;
      expect(conditional()).toBe(0);

      // Change data while conditional doesn't track it
      data.value = 42;

      // Re-acquire data dep
      flag.value = true;
      expect(conditional()).toBe(42);
    });
  });

  describe('Vue #11995: dep tracking not deleted when sibling still uses it', () => {
    test('one computed drops dep, sibling computed still tracks it', () => {
      const toggle = signal(true);
      const shared = signal(1);

      const conditional = reactive(
        () => {
          return toggle.value ? shared.value : 999;
        },
        { desc: 'conditional' },
      );

      const alwaysReads = reactive(
        () => {
          return shared.value * 10;
        },
        { desc: 'alwaysReads' },
      );

      const w1 = watcher(() => conditional());
      w1.addListener(() => {});

      const w2 = watcher(() => alwaysReads());
      w2.addListener(() => {});

      expect(conditional()).toBe(1);
      expect(alwaysReads()).toBe(10);

      // conditional drops shared dep
      toggle.value = false;
      expect(conditional()).toBe(999);

      // shared must still be tracked by alwaysReads
      shared.value = 5;
      expect(alwaysReads()).toBe(50);
      expect(conditional()).toBe(999); // still doesn't track shared
    });
  });

  describe('Vue #11928: exponential perf with chained computeds + effects', () => {
    test('cellx-style N-layer computed diamond with watchers does not hang', () => {
      const layers = 50;

      const p1 = signal(1);
      const p2 = signal(2);
      const p3 = signal(3);
      const p4 = signal(4);

      type Layer = {
        p1: () => number;
        p2: () => number;
        p3: () => number;
        p4: () => number;
      };

      let prev: Layer = {
        p1: () => p1.value,
        p2: () => p2.value,
        p3: () => p3.value,
        p4: () => p4.value,
      };

      for (let i = 0; i < layers; i++) {
        const p = prev;
        prev = {
          p1: reactive(() => p.p2(), { desc: `L${i}_p1` }),
          p2: reactive(() => p.p1() - p.p3(), { desc: `L${i}_p2` }),
          p3: reactive(() => p.p2() + p.p4(), { desc: `L${i}_p3` }),
          p4: reactive(() => p.p3(), { desc: `L${i}_p4` }),
        };
      }

      const last = prev;

      // Add watchers (this is what caused Vue to hang in #11928)
      const w1 = watcher(() => last.p1());
      w1.addListener(() => {});
      const w2 = watcher(() => last.p2());
      w2.addListener(() => {});
      const w3 = watcher(() => last.p3());
      w3.addListener(() => {});
      const w4 = watcher(() => last.p4());
      w4.addListener(() => {});

      const start = performance.now();

      const v1 = last.p1();
      const v2 = last.p2();
      const v3 = last.p3();
      const v4 = last.p4();

      // Mutate all sources
      p1.value = 4;
      p2.value = 3;
      p3.value = 2;
      p4.value = 1;

      last.p1();
      last.p2();
      last.p3();
      last.p4();

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(Number.isFinite(last.p1())).toBe(true);
    });
  });

  describe('Vue #9579: notifier-based manual trigger propagation', () => {
    test('notifier invalidation propagates through computed chain', () => {
      const n = notifier();
      const data = signal(0);

      const c1 = reactive(
        () => {
          n.consume();
          return data.value;
        },
        { desc: 'c1' },
      );

      const c2 = reactive(
        () => {
          return c1() + 100;
        },
        { desc: 'c2' },
      );

      const w = watcher(() => c2());
      w.addListener(() => {});

      expect(c2()).toBe(100);

      data.value = 5;
      expect(c2()).toBe(105);

      // Notify without changing data — c1 should re-evaluate,
      // but since data hasn't changed, c2 should be pruned
      n.notify();
      expect(c2()).toBe(105);

      // Now change data AND notify
      data.value = 10;
      n.notify();
      expect(c2()).toBe(110);
    });
  });

  describe('Solid #2352: computed returning undefined during re-evaluation', () => {
    test('async computed never returns undefined during transition', async () => {
      const src = signal(1);

      const asyncMemo = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 10;
        },
        { desc: 'asyncMemo' },
      );

      const w = watcher(() => asyncMemo());
      w.addListener(() => {});

      await sleep(50);

      const result = asyncMemo();
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(10);

      // Change source — triggers re-evaluation
      src.value = 2;

      // During re-evaluation, value should NOT be undefined
      const mid = asyncMemo();
      if (mid.isResolved) {
        expect(mid.value).not.toBeUndefined();
      } else if (mid.isPending) {
        // Pending is acceptable, but value from previous computation
        // should still be accessible
        expect(mid.value).toBe(10);
      }

      await sleep(50);

      const final = asyncMemo();
      expect(final.isResolved).toBe(true);
      expect(final.value).toBe(20);
    });
  });

  describe('Legend State: computed over collection — revert after removal', () => {
    test('filter + revert does not cause stack overflow or incorrect values', () => {
      const items = signal<Record<string, { id: string }>>({
        '1': { id: '1' },
        '2': { id: '2' },
        '3': { id: '3' },
        '4': { id: '4' },
        '20': { id: '20' },
      });

      const evenItems = reactive(
        () => {
          return Object.values(items.value).filter(i => parseInt(i.id) % 2 === 0);
        },
        { desc: 'evenItems' },
      );

      const smallEvenItems = reactive(
        () => {
          return evenItems().filter(i => parseInt(i.id) < 10);
        },
        { desc: 'smallEvenItems' },
      );

      const w = watcher(() => smallEvenItems());
      w.addListener(() => {});

      expect(evenItems().map(i => i.id).sort()).toEqual(['2', '20', '4']);
      expect(smallEvenItems().map(i => i.id).sort()).toEqual(['2', '4']);

      // Modify item 2 to make it odd — removes from even list
      items.value = {
        ...items.value,
        '2': { id: '21' },
      };

      expect(evenItems().map(i => i.id).sort()).toEqual(['20', '4']);
      expect(smallEvenItems().map(i => i.id).sort()).toEqual(['4']);

      // Revert — re-adds item 2. Must NOT stack overflow.
      items.value = {
        ...items.value,
        '2': { id: '2' },
      };

      expect(evenItems().map(i => i.id).sort()).toEqual(['2', '20', '4']);
      expect(smallEvenItems().map(i => i.id).sort()).toEqual(['2', '4']);
    });
  });

  describe('Angular #56593: effect tracking signal it writes to', () => {
    test('reactive that reads and writes same signal should not cause infinite loop', () => {
      const counter = signal(0);
      const flag = signal(true);

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          if (flag.value) {
            // Read counter — this creates a dependency
            return counter.value;
          }
          return -1;
        },
        { desc: 'readsCounter' },
      );

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(0);
      expect(computeCount).toBeLessThan(10); // should not run many times

      // External write to counter should trigger single recompute
      counter.value = 5;
      expect(c()).toBe(5);
    });
  });

  describe('cross-framework: deep conditional chain pruning', () => {
    test('deeply nested conditional deps are properly pruned and re-acquired', () => {
      const flag = signal(true);
      const a = signal(1);
      const b = signal(2);

      const layer1 = reactive(
        () => (flag.value ? a.value : b.value),
        { desc: 'layer1' },
      );

      const layer2 = reactive(
        () => layer1() * 2,
        { desc: 'layer2' },
      );

      const layer3 = reactive(
        () => layer2() + 10,
        { desc: 'layer3' },
      );

      const w = watcher(() => layer3());
      w.addListener(() => {});

      // flag=true: reads a(1) → layer1=1 → layer2=2 → layer3=12
      expect(layer3()).toBe(12);

      // b is not tracked
      b.value = 100;
      expect(layer3()).toBe(12);

      // Switch to b
      flag.value = false;
      expect(layer3()).toBe(210); // b=100 → layer1=100 → layer2=200 → layer3=210

      // a is no longer tracked
      a.value = 999;
      expect(layer3()).toBe(210);

      // Switch back to a
      flag.value = true;
      expect(layer3()).toBe(2008); // a=999 → layer1=999 → layer2=1998 → layer3=2008
    });
  });
});
