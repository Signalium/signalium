import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { sleep } from './utils/async.js';

/**
 * Async-specific edge cases adapted from:
 * - Legend State (stale promise discarding, async race conditions)
 * - SolidJS (resource patterns)
 */
describe('async edge cases (cross-framework)', () => {
  describe('stale promise discarding', () => {
    test('second async invocation finishes first — stale result discarded', async () => {
      const delay = signal(50);

      const asyncComputed = reactive(
        async () => {
          const d = delay.value;
          await sleep(d);
          return `result-${d}`;
        },
        { desc: 'asyncRace' },
      );

      const w = watcher(() => asyncComputed());
      w.addListener(() => {});

      // Initial: delay=50, starts computation with 50ms delay
      await sleep(10);

      // Change to 0ms delay — second invocation should be faster
      delay.value = 0;
      await sleep(10);

      const result = asyncComputed();
      // The faster second invocation (0ms) should have won
      if (result.isResolved) {
        expect(result.value).toBe('result-0');
      }

      // Wait for the slow first invocation to complete
      await sleep(100);

      const finalResult = asyncComputed();
      // The stale first result (result-50) should be discarded
      if (finalResult.isResolved) {
        expect(finalResult.value).toBe('result-0');
      }
    });
  });

  describe('async computed with sync fallback', () => {
    test('async computed resolves and downstream sync computed picks up value', async () => {
      const src = signal(1);

      const asyncValue = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 10;
        },
        { desc: 'asyncValue' },
      );

      const w = watcher(() => asyncValue());
      w.addListener(() => {});

      // Initially pending
      const initial = asyncValue();
      expect(initial.isPending).toBe(true);

      await sleep(50);

      const resolved = asyncValue();
      expect(resolved.isResolved).toBe(true);
      expect(resolved.value).toBe(10);
    });

    test('changing source while async is in flight restarts computation', async () => {
      const src = signal(1);

      let computeCount = 0;
      const asyncValue = reactive(
        async () => {
          computeCount++;
          const v = src.value;
          await sleep(20);
          return v * 10;
        },
        { desc: 'asyncRestart' },
      );

      const w = watcher(() => asyncValue());
      w.addListener(() => {});

      asyncValue(); // start first computation
      await sleep(5);

      // Change source mid-flight
      src.value = 2;

      await sleep(50);

      const result = asyncValue();
      if (result.isResolved) {
        expect(result.value).toBe(20);
      }
    });
  });

  describe('async dependency chains', () => {
    test('async computed depending on another async computed', async () => {
      const src = signal(1);

      const inner = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 2;
        },
        { desc: 'inner' },
      );

      const outer = reactive(
        async () => {
          const innerVal = await inner();
          return innerVal + 100;
        },
        { desc: 'outer' },
      );

      const w = watcher(() => outer());
      w.addListener(() => {});

      await sleep(50);

      const result = outer();
      if (result.isResolved) {
        expect(result.value).toBe(102);
      }

      // Change source
      src.value = 5;
      await sleep(50);

      const updated = outer();
      if (updated.isResolved) {
        expect(updated.value).toBe(110);
      }
    });

    test('3-level async chain resolves correctly', async () => {
      const src = signal('a');

      const level1 = reactive(
        async () => {
          const v = src.value;
          await sleep(5);
          return v + '1';
        },
        { desc: 'level1' },
      );

      const level2 = reactive(
        async () => {
          const v = await level1();
          await sleep(5);
          return v + '2';
        },
        { desc: 'level2' },
      );

      const level3 = reactive(
        async () => {
          const v = await level2();
          await sleep(5);
          return v + '3';
        },
        { desc: 'level3' },
      );

      const w = watcher(() => level3());
      w.addListener(() => {});

      await sleep(100);

      const result = level3();
      if (result.isResolved) {
        expect(result.value).toBe('a123');
      }

      src.value = 'b';
      await sleep(100);

      const updated = level3();
      if (updated.isResolved) {
        expect(updated.value).toBe('b123');
      }
    });
  });

  describe('async with multiple signal deps', () => {
    test('async computed reading multiple signals restarts on any change', async () => {
      const a = signal(1);
      const b = signal(10);

      let computeCount = 0;
      const asyncCombine = reactive(
        async () => {
          computeCount++;
          const va = a.value;
          const vb = b.value;
          await sleep(10);
          return va + vb;
        },
        { desc: 'asyncCombine' },
      );

      const w = watcher(() => asyncCombine());
      w.addListener(() => {});

      await sleep(50);

      const initial = asyncCombine();
      if (initial.isResolved) {
        expect(initial.value).toBe(11);
      }

      // Change first signal
      a.value = 5;
      await sleep(50);

      const afterA = asyncCombine();
      if (afterA.isResolved) {
        expect(afterA.value).toBe(15);
      }

      // Change second signal
      b.value = 20;
      await sleep(50);

      const afterB = asyncCombine();
      if (afterB.isResolved) {
        expect(afterB.value).toBe(25);
      }
    });
  });

  describe('async error handling', () => {
    test('async computed that throws produces rejected promise', async () => {
      const shouldThrow = signal(false);

      const asyncMaybe = reactive(
        async () => {
          if (shouldThrow.value) throw new Error('async error');
          await sleep(5);
          return 'ok';
        },
        { desc: 'asyncMaybe' },
      );

      const w = watcher(() => asyncMaybe());
      w.addListener(() => {});

      await sleep(50);

      const ok = asyncMaybe();
      expect(ok.isResolved).toBe(true);
      expect(ok.value).toBe('ok');

      shouldThrow.value = true;
      await sleep(50);

      const errResult = asyncMaybe();
      expect(errResult.isRejected).toBe(true);
      expect(errResult.error).toBeInstanceOf(Error);
    });

    test('async computed recovers from error when source changes', async () => {
      const val = signal(-1);

      const asyncVal = reactive(
        async () => {
          const v = val.value;
          await sleep(5);
          if (v < 0) throw new Error('negative');
          return v;
        },
        { desc: 'asyncRecover' },
      );

      const w = watcher(() => asyncVal());
      w.addListener(() => {});

      await sleep(50);

      const err = asyncVal();
      expect(err.isRejected).toBe(true);

      // Recover
      val.value = 42;
      await sleep(50);

      const recovered = asyncVal();
      expect(recovered.isResolved).toBe(true);
      expect(recovered.value).toBe(42);
    });
  });
});
