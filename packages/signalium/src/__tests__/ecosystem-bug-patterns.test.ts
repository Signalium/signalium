import { describe, expect, test } from 'vitest';
import { signal, watcher, notifier, settled } from 'signalium';
import { reactive, relay } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

/**
 * Bug patterns mined from other frameworks' issue trackers:
 * - Preact: NaN loops, dependency switching, stale computeds
 * - Vue: object identity instability, writes during computed, deep chain hangs
 * - SolidJS: stale values after await in suspense, createMemo returning undefined
 * - MobX: disposal timing, reaction ordering, async boundary tracking loss
 * - TanStack Query: observer cancellation during in-flight fetch
 * - TC39 Signals: writes during computed, settled callback ordering
 */
describe('ecosystem bug patterns', () => {
  describe('object identity instability (Vue #9474)', () => {
    test('computed returning new array reference each time should still be usable', () => {
      const items = signal([1, 2, 3]);

      const mapped = reactive(
        () => {
          return items.value.map(x => x * 2);
        },
        { desc: 'mapped' },
      );

      const w = watcher(() => mapped());
      w.addListener(() => {});

      const r1 = mapped();
      expect(r1).toEqual([2, 4, 6]);

      // Reading again produces a new reference but same content
      const r2 = mapped();
      // The references will be different objects
      // but the computed should not infinitely retrigger
    });

    test('computed returning new object should not cause infinite watcher loops', async () => {
      const src = signal(1);

      let computeCount = 0;
      const obj = reactive(
        () => {
          computeCount++;
          return { value: src.value, label: `item-${src.value}` };
        },
        { desc: 'obj' },
      );

      let listenerCount = 0;
      const w = watcher(() => obj());
      w.addListener(() => {
        listenerCount++;
      });

      // Force initial evaluation
      obj();
      await settled();

      const initCount = computeCount;

      src.value = 2;
      obj();
      await settled();

      // Should compute a bounded number of times, not infinitely loop
      expect(computeCount - initCount).toBeLessThan(5);
    });
  });

  describe('signal write during computed evaluation', () => {
    test('writing to a signal inside a computed should not cause infinite recomputation', () => {
      const counter = signal(0);

      let computeCount = 0;
      const derived = reactive(
        () => {
          computeCount++;
          const v = counter.value;
          if (v === 0) {
            counter.value = 1; // side-effect write
          }
          return v;
        },
        { desc: 'derived' },
      );

      const w = watcher(() => derived());
      w.addListener(() => {});

      // Should stabilize without infinite loop
      expect(computeCount).toBeLessThan(10);
    });

    test('two computeds writing to each others deps should not infinitely loop', () => {
      const a = signal(1);
      const b = signal(1);

      let aCount = 0;
      let bCount = 0;

      const readA = reactive(
        () => {
          aCount++;
          const val = a.value;
          if (val !== b.value) {
            b.value = val; // sync b to a
          }
          return val;
        },
        { desc: 'readA' },
      );

      const readB = reactive(
        () => {
          bCount++;
          return b.value;
        },
        { desc: 'readB' },
      );

      const w1 = watcher(() => readA());
      w1.addListener(() => {});
      const w2 = watcher(() => readB());
      w2.addListener(() => {});

      a.value = 2;

      // Should stabilize
      expect(aCount).toBeLessThan(20);
      expect(bCount).toBeLessThan(20);
    });
  });

  describe('watcher removal during async computation (TanStack #3045)', () => {
    /**
     * BUG: After removing the last watcher while an async computation is
     * in-flight, reading the reactive function returns a result with
     * value === undefined, not the last resolved value.
     *
     * Inspired by TanStack Query #3045 where removing the last observer
     * cancels in-flight fetches. In signalium, the async computation's
     * result appears to be lost when all watchers are removed mid-flight.
     *
     * Impact: If a component unmounts while data is loading, re-mounting
     * and reading the same reactive function returns undefined instead of
     * the last known value.
     */
    test.fails('removing last watcher while async reactive is mid-computation', async () => {
      const src = signal(1);

      let computeCount = 0;
      const asyncComputed = reactive(
        async () => {
          computeCount++;
          const v = src.value;
          await sleep(20);
          return v * 2;
        },
        { desc: 'asyncComputed' },
      );

      const w = watcher(() => asyncComputed());
      const unsub = w.addListener(() => {});

      await sleep(30);
      expect(asyncComputed().value).toBe(2);

      // Trigger a recomputation
      src.value = 2;

      // Remove watcher while async computation is mid-flight
      await sleep(5);
      unsub();

      // Wait for the async to finish
      await sleep(30);

      // ACTUAL: result.value is undefined — the async result is lost
      // when all watchers are removed mid-flight
      const result = asyncComputed();
      expect(result.value === 2 || result.value === 4).toBe(true);
    });

    test('adding new watcher after removing all watchers during async computation', async () => {
      const src = signal(1);

      const asyncComputed = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v;
        },
        { desc: 'asyncComputed' },
      );

      // First watcher
      const w1 = watcher(() => asyncComputed());
      const unsub1 = w1.addListener(() => {});

      await sleep(20);
      expect(asyncComputed().value).toBe(1);

      // Remove first watcher
      unsub1();

      // Change value
      src.value = 2;

      // Add new watcher
      const w2 = watcher(() => asyncComputed());
      w2.addListener(() => {});

      await sleep(30);

      // New watcher should see the updated value
      const result = asyncComputed();
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(2);
    });
  });

  describe('dependency tracking across await boundaries', () => {
    test('signal read ONLY before await is properly tracked', async () => {
      const tracked = signal(1);
      const unrelated = signal(100);

      let computeCount = 0;
      const asyncReactive = reactive(
        async () => {
          computeCount++;
          const v = tracked.value; // read before await
          await sleep(5);
          // unrelated is NOT read
          return v;
        },
        { desc: 'onlyBefore' },
      );

      const w = watcher(() => asyncReactive());
      w.addListener(() => {});

      await sleep(20);
      expect(asyncReactive().value).toBe(1);
      computeCount = 0;

      // Changing the tracked signal should trigger recomputation
      tracked.value = 2;
      await sleep(20);
      expect(asyncReactive().value).toBe(2);
      expect(computeCount).toBe(1);

      computeCount = 0;
      // Changing the unrelated signal should NOT trigger recomputation
      unrelated.value = 200;
      await sleep(20);
      expect(computeCount).toBe(0);
    });

    test('signal read ONLY after await is properly tracked', async () => {
      const afterAwait = signal(10);
      const trigger = signal(0);

      let computeCount = 0;
      const asyncReactive = reactive(
        async () => {
          computeCount++;
          trigger.value; // just to have a dep before await
          await sleep(5);
          return afterAwait.value; // read after await
        },
        { desc: 'onlyAfter' },
      );

      const w = watcher(() => asyncReactive());
      w.addListener(() => {});

      await sleep(20);
      expect(asyncReactive().value).toBe(10);
      computeCount = 0;

      // Changing signal read after await should trigger recomputation
      afterAwait.value = 20;
      await sleep(20);
      expect(asyncReactive().value).toBe(20);
      expect(computeCount).toBeGreaterThanOrEqual(1);
    });

    test('dependency switch across await boundary', async () => {
      const cond = signal(true);
      const a = signal('A');
      const b = signal('B');

      const asyncBranch = reactive(
        async () => {
          const useCond = cond.value;
          await sleep(5);
          // Conditional read AFTER await
          return useCond ? a.value : b.value;
        },
        { desc: 'asyncBranch' },
      );

      const w = watcher(() => asyncBranch());
      w.addListener(() => {});

      await sleep(20);
      expect(asyncBranch().value).toBe('A');

      // Switch condition
      cond.value = false;
      await sleep(20);
      expect(asyncBranch().value).toBe('B');

      // Now a should be untracked — changing it should not trigger recompute
      a.value = 'A2';
      await sleep(20);
      expect(asyncBranch().value).toBe('B');

      // b should be tracked
      b.value = 'B2';
      await sleep(20);
      expect(asyncBranch().value).toBe('B2');
    });
  });

  describe('relay disposal timing (MobX #4547)', () => {
    test('relay deactivated while another relay depends on the same signal', async () => {
      const shared = signal(1);

      const relay1 = relay<number>(
        state => {
          state.value = shared.value * 10;
          return {
            update: () => {
              state.value = shared.value * 10;
            },
            deactivate: () => {},
          };
        },
        { desc: 'relay1' },
      );

      const relay2 = relay<number>(
        state => {
          state.value = shared.value * 100;
          return {
            update: () => {
              state.value = shared.value * 100;
            },
            deactivate: () => {},
          };
        },
        { desc: 'relay2' },
      );

      const useBoth = signal(true);

      const consumer = reactive(
        () => {
          if (useBoth.value) {
            return relay1.value! + relay2.value!;
          }
          return relay1.value!;
        },
        { desc: 'consumer' },
      );

      // Watch to activate both relays
      expect(consumer).toHaveSignalValue(110); // 10 + 100
      expect(relay1).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
      expect(relay2).toHaveCounts({ subscribe: 1, unsubscribe: 0 });

      // Stop using relay2
      useBoth.value = false;
      await settled();

      expect(consumer).toHaveSignalValue(10);

      // relay1 should still be active
      shared.value = 2;
      await settled();

      expect(consumer).toHaveSignalValue(20);
    });

    test('rapid relay activation/deactivation cycle', async () => {
      const toggle = signal(true);

      const testRelay = relay<number>(
        state => {
          state.value = 42;
          return {
            update: () => {},
            deactivate: () => {},
          };
        },
        { desc: 'rapidRelay' },
      );

      const consumer = reactive(
        () => {
          return toggle.value ? testRelay.value : -1;
        },
        { desc: 'consumer' },
      );

      expect(consumer).toHaveSignalValue(42);

      // Rapidly toggle 10 times
      for (let i = 0; i < 10; i++) {
        toggle.value = false;
        toggle.value = true;
      }

      await settled();

      // Should end up with relay active and correct value
      expect(consumer).toHaveSignalValue(42);
    });
  });

  describe('multiple watchers lifecycle', () => {
    test('adding and removing watchers in rapid succession', () => {
      const src = signal(0);
      const derived = reactive(() => src.value * 2, { desc: 'derived' });

      const unsubs: (() => void)[] = [];

      // Add 10 watchers
      for (let i = 0; i < 10; i++) {
        const w = watcher(() => derived());
        unsubs.push(w.addListener(() => {}));
      }

      src.value = 5;
      expect(derived()).toBe(10);

      // Remove all watchers
      for (const unsub of unsubs) {
        unsub();
      }

      // Change value — no watchers, should still compute on demand
      src.value = 10;
      expect(derived()).toBe(20);
    });

    test('watcher added after all watchers removed still sees fresh values', () => {
      const src = signal(1);
      const derived = reactive(() => src.value + 1, { desc: 'derived' });

      // First watcher
      const w1 = watcher(() => derived());
      const unsub1 = w1.addListener(() => {});
      expect(derived()).toBe(2);

      // Remove
      unsub1();

      // Change value while no watchers
      src.value = 5;

      // New watcher should see fresh value
      const w2 = watcher(() => derived());
      w2.addListener(() => {});
      expect(derived()).toBe(6);
    });
  });

  describe('glitch-free guarantees under stress', () => {
    test('watcher never sees inconsistent intermediate state in diamond', async () => {
      const src = signal(0);

      const left = reactive(() => src.value + 1, { desc: 'left' });
      const right = reactive(() => src.value + 2, { desc: 'right' });
      const bottom = reactive(() => left() + right(), { desc: 'bottom' });

      const observedValues: number[] = [];

      const w = watcher(() => bottom());
      w.addListener(() => {
        observedValues.push(bottom() as number);
      });

      // Initial: left=1, right=2, bottom=3
      expect(bottom()).toBe(3);

      // Rapidly update
      for (let i = 1; i <= 20; i++) {
        src.value = i;
      }

      await settled();

      // Every observed value should be consistent: (src+1) + (src+2) = 2*src + 3
      for (const val of observedValues) {
        const srcVal = (val - 3) / 2;
        expect(Number.isInteger(srcVal)).toBe(true);
        expect(srcVal).toBeGreaterThanOrEqual(0);
        expect(srcVal).toBeLessThanOrEqual(20);
      }
    });

    test('deep chain never shows partially-updated intermediate values', async () => {
      const src = signal(0);

      const chain: (() => number)[] = [reactive(() => src.value, { desc: 'c0' })];
      for (let i = 1; i < 10; i++) {
        const prev = chain[i - 1];
        chain.push(reactive(() => prev() + 1, { desc: `c${i}` }));
      }

      const tail = chain[chain.length - 1];

      const observedValues: number[] = [];
      const w = watcher(() => tail());
      w.addListener(() => {
        observedValues.push(tail() as number);
      });

      expect(tail()).toBe(9);

      for (let i = 1; i <= 50; i++) {
        src.value = i;
      }

      await settled();

      // Every observed value should be src + 9
      for (const val of observedValues) {
        const srcVal = val - 9;
        expect(Number.isInteger(srcVal)).toBe(true);
        expect(srcVal).toBeGreaterThanOrEqual(0);
        expect(srcVal).toBeLessThanOrEqual(50);
      }
    });
  });

  describe('notifier with sync+async mixed chains', () => {
    test('notifier invalidates sync computed that feeds into async computed', async () => {
      const n = notifier();
      const data = signal('hello');

      const syncDerived = reactive(
        () => {
          n.consume();
          return data.value.toUpperCase();
        },
        { desc: 'syncDerived' },
      );

      const asyncConsumer = reactive(
        async () => {
          const v = syncDerived();
          await sleep(5);
          return `result: ${v}`;
        },
        { desc: 'asyncConsumer' },
      );

      const w = watcher(() => asyncConsumer());
      w.addListener(() => {});

      await sleep(20);
      expect(asyncConsumer().value).toBe('result: HELLO');

      // Notifier invalidates sync, which invalidates async
      data.value = 'world';
      n.notify();

      await sleep(30);
      expect(asyncConsumer().value).toBe('result: WORLD');
    });

    test('notifier-only invalidation (no value change) in sync→async chain', async () => {
      const n = notifier();
      const data = signal('stable');

      let syncCount = 0;
      const syncDerived = reactive(
        () => {
          syncCount++;
          n.consume();
          return data.value;
        },
        { desc: 'syncDerived' },
      );

      let asyncCount = 0;
      const asyncConsumer = reactive(
        async () => {
          asyncCount++;
          const v = syncDerived();
          await sleep(5);
          return v;
        },
        { desc: 'asyncConsumer' },
      );

      const w = watcher(() => asyncConsumer());
      w.addListener(() => {});

      await sleep(20);
      expect(asyncConsumer().value).toBe('stable');

      // Notify without changing data — sync recomputes but value is same
      n.notify();

      await sleep(30);

      // async should see the value hasn't changed
      expect(asyncConsumer().value).toBe('stable');
      expect(asyncConsumer().isResolved).toBe(true);
      expect(asyncConsumer().isPending).toBe(false);
    });

    test('concurrent notifier + signal change with sync intermediate', async () => {
      const n = notifier();
      const entity = signal(100);
      const storage = signal('data');

      const syncLayer = reactive(
        () => {
          n.consume();
          return storage.value;
        },
        { desc: 'syncLayer' },
      );

      const asyncLayer = reactive(
        async () => {
          const v = syncLayer();
          await sleep(10);
          return v;
        },
        { desc: 'asyncLayer' },
      );

      const consumer = reactive(
        async () => {
          const chainValue = await asyncLayer();
          const entityValue = entity.value;
          return `${chainValue}-${entityValue}`;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});

      await sleep(50);
      expect(consumer().value).toBe('data-100');

      // Concurrent notifier + signal change
      n.notify();
      entity.value = 200;

      await sleep(100);

      expect(consumer().isResolved).toBe(true);
      expect(consumer().isPending).toBe(false);
      expect(consumer().value).toBe('data-200');
    });
  });
});
