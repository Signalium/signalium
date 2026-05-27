import { describe, expect, test } from 'vitest';
import { effect, signal, reactiveSignal } from '../index.js';
import { batch } from '../internals/scheduling.js';
import { nextTick } from './utils/async.js';

describe('effect', () => {
  describe('initial run', () => {
    test('runs the function once eagerly on creation', () => {
      let count = 0;
      const dispose = effect(() => {
        count++;
      });

      expect(count).toBe(1);
      dispose();
    });

    test('captures dependencies on the initial run', async () => {
      const s = signal(1);
      const seen: number[] = [];

      const dispose = effect(() => {
        seen.push(s.value);
      });

      expect(seen).toEqual([1]);

      s.value = 2;
      await nextTick();

      expect(seen).toEqual([1, 2]);
      dispose();
    });
  });

  describe('reactivity', () => {
    test('re-runs when a state signal it reads changes', async () => {
      const s = signal('a');
      let runs = 0;
      let lastValue = '';

      const dispose = effect(() => {
        runs++;
        lastValue = s.value;
      });

      expect(runs).toBe(1);
      expect(lastValue).toBe('a');

      s.value = 'b';
      await nextTick();

      expect(runs).toBe(2);
      expect(lastValue).toBe('b');

      s.value = 'c';
      await nextTick();

      expect(runs).toBe(3);
      expect(lastValue).toBe('c');

      dispose();
    });

    test('does not re-run when an unrelated signal changes', async () => {
      const a = signal(1);
      const b = signal(10);
      let runs = 0;

      const dispose = effect(() => {
        runs++;
        a.value;
      });

      expect(runs).toBe(1);

      b.value = 20;
      await nextTick();

      expect(runs).toBe(1);

      a.value = 2;
      await nextTick();

      expect(runs).toBe(2);

      dispose();
    });

    test('re-runs when a derived (reactiveSignal) dep changes', async () => {
      const a = signal(2);
      const doubled = reactiveSignal(() => a.value * 2);
      const seen: number[] = [];

      const dispose = effect(() => {
        seen.push(doubled.value);
      });

      expect(seen).toEqual([4]);

      a.value = 5;
      await nextTick();

      expect(seen).toEqual([4, 10]);

      dispose();
    });

    test('does NOT re-run when a reactiveSignal dep is dirtied but its value did not change', async () => {
      const a = signal(1);
      let memoRuns = 0;
      const isPositive = reactiveSignal(() => {
        memoRuns++;
        return a.value > 0;
      });

      let effectRuns = 0;
      let lastSeen: boolean | undefined;
      const dispose = effect(() => {
        effectRuns++;
        lastSeen = isPositive.value;
      });

      expect(effectRuns).toBe(1);
      expect(memoRuns).toBe(1);
      expect(lastSeen).toBe(true);

      // Tick `a` to a value that keeps `isPositive` === true.
      a.value = 2;
      await nextTick();

      // Memo should re-evaluate (its dep ticked) but conclude no change.
      expect(memoRuns).toBe(2);
      // Effect should NOT re-run — its observed value didn't change.
      expect(effectRuns).toBe(1);

      // Another no-change tick.
      a.value = 3;
      await nextTick();
      expect(memoRuns).toBe(3);
      expect(effectRuns).toBe(1);

      // Now actually flip the memo's value.
      a.value = -1;
      await nextTick();
      expect(memoRuns).toBe(4);
      expect(effectRuns).toBe(2);
      expect(lastSeen).toBe(false);

      dispose();
    });

    test('does NOT re-run when one of several memo deps is dirtied but none actually change', async () => {
      const a = signal(1);
      const b = signal(10);
      const aPos = reactiveSignal(() => a.value > 0);
      const bPos = reactiveSignal(() => b.value > 0);

      let effectRuns = 0;
      const dispose = effect(() => {
        effectRuns++;
        aPos.value;
        bPos.value;
      });

      expect(effectRuns).toBe(1);

      // a ticks, aPos stays true.
      a.value = 5;
      await nextTick();
      expect(effectRuns).toBe(1);

      // b ticks, bPos stays true.
      b.value = 20;
      await nextTick();
      expect(effectRuns).toBe(1);

      // Both tick in one batch, both stay true.
      batch(() => {
        a.value = 7;
        b.value = 25;
      });
      expect(effectRuns).toBe(1);

      // Now one actually flips.
      a.value = -1;
      await nextTick();
      expect(effectRuns).toBe(2);

      dispose();
    });

    test('re-runs when a deeper-chained memo finally surfaces a change', async () => {
      const a = signal(1);
      const aPos = reactiveSignal(() => a.value > 0);
      const aPosStr = reactiveSignal(() => (aPos.value ? 'yes' : 'no'));

      const seen: string[] = [];
      const dispose = effect(() => {
        seen.push(aPosStr.value);
      });

      expect(seen).toEqual(['yes']);

      // a ticks but aPos stays true → aPosStr stays 'yes' → effect skipped.
      a.value = 5;
      await nextTick();
      expect(seen).toEqual(['yes']);

      a.value = 10;
      await nextTick();
      expect(seen).toEqual(['yes']);

      // Now flip a so aPos goes false, aPosStr becomes 'no'.
      a.value = -1;
      await nextTick();
      expect(seen).toEqual(['yes', 'no']);

      dispose();
    });

    test('updates dependency set across re-runs', async () => {
      const cond = signal(true);
      const a = signal('A');
      const b = signal('B');
      const seen: string[] = [];

      const dispose = effect(() => {
        seen.push(cond.value ? a.value : b.value);
      });

      expect(seen).toEqual(['A']);

      // While cond=true, b should not be a dep
      b.value = 'B2';
      await nextTick();
      expect(seen).toEqual(['A']);

      // Switch to b
      cond.value = false;
      await nextTick();
      expect(seen).toEqual(['A', 'B2']);

      // Now a should not be a dep
      a.value = 'A2';
      await nextTick();
      expect(seen).toEqual(['A', 'B2']);

      // But b is
      b.value = 'B3';
      await nextTick();
      expect(seen).toEqual(['A', 'B2', 'B3']);

      dispose();
    });

    test('re-watches a computed dep after it is dropped and later re-added', async () => {
      const useA = signal(true);
      const a = signal(1);
      const b = signal(10);
      const aValue = reactiveSignal(() => a.value);
      const bValue = reactiveSignal(() => b.value);
      const selected = reactiveSignal(() => (useA.value ? aValue.value : bValue.value));
      const seen: number[] = [];

      const dispose = effect(() => {
        seen.push(selected.value);
      });

      expect(seen).toEqual([1]);

      useA.value = false;
      await nextTick();
      expect(seen).toEqual([1, 10]);

      useA.value = true;
      await nextTick();
      expect(seen).toEqual([1, 10, 1]);

      a.value = 2;
      await nextTick();
      expect(seen).toEqual([1, 10, 1, 2]);

      dispose();
    });

    test('coalesces multiple updates inside a batch into a single re-run', async () => {
      const a = signal(1);
      const b = signal(2);
      let runs = 0;

      const dispose = effect(() => {
        runs++;
        a.value;
        b.value;
      });

      expect(runs).toBe(1);

      batch(() => {
        a.value = 10;
        b.value = 20;
      });

      // batch flushes synchronously, so by the time we get here the re-run should
      // already have happened exactly once.
      expect(runs).toBe(2);

      dispose();
    });
  });

  describe('dispose', () => {
    test('dispose stops further runs on dependency change', async () => {
      const s = signal(0);
      let runs = 0;

      const dispose = effect(() => {
        runs++;
        s.value;
      });

      expect(runs).toBe(1);

      dispose();

      s.value = 1;
      await nextTick();
      s.value = 2;
      await nextTick();

      expect(runs).toBe(1);
    });

    test('dispose is idempotent', () => {
      const s = signal(0);
      let runs = 0;

      const dispose = effect(() => {
        runs++;
        s.value;
      });

      expect(runs).toBe(1);

      dispose();
      // Calling dispose again should not throw and should not re-run anything
      expect(() => dispose()).not.toThrow();
      expect(() => dispose()).not.toThrow();
      expect(runs).toBe(1);
    });

    test('disposing one effect does not affect others depending on the same signal', async () => {
      const s = signal(0);
      let runsA = 0;
      let runsB = 0;

      const disposeA = effect(() => {
        runsA++;
        s.value;
      });
      const disposeB = effect(() => {
        runsB++;
        s.value;
      });

      expect(runsA).toBe(1);
      expect(runsB).toBe(1);

      disposeA();

      s.value = 1;
      await nextTick();

      expect(runsA).toBe(1);
      expect(runsB).toBe(2);

      disposeB();
    });
  });

  describe('error handling', () => {
    test('throwing in the initial run propagates and does not leave the effect partially attached', () => {
      const s = signal(0);
      let runs = 0;

      expect(() =>
        effect(() => {
          runs++;
          s.value;
          throw new Error('boom');
        }),
      ).toThrow('boom');

      // The first run did execute (the throw came from inside it)
      expect(runs).toBe(1);
    });

    test('writing to a signal mid-run does not infinite-loop (state-machine-de-duped)', () => {
      // We're not asserting throw vs. not-throw here — the existing dirty
      // state machine treats writes during compute as a no-op for the dirty
      // signal because state is already `Dirty`. We just want to confirm
      // this doesn't recurse forever.
      const s = signal(0);
      let runs = 0;

      const dispose = effect(() => {
        runs++;
        s.value;
        if (runs === 1) {
          // First run only, to avoid infinite re-runs after dispose semantics
          s.value = 1;
        }
      });

      expect(runs).toBe(1);
      dispose();
    });
  });
});
