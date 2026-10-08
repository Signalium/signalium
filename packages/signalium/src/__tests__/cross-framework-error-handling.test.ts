import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Error handling and propagation edge cases adapted from:
 * - preact-signals (error caching, graph consistency after errors)
 * - TC39 signal-polyfill (errors.test.ts)
 * - Vue reactivity (error recovery)
 */
describe('error handling edge cases', () => {
  describe('error caching in computed', () => {
    /**
     * BUG: Signalium does not cache thrown errors.
     *
     * In Preact Signals, TC39 polyfill, and Vue, when a computed throws,
     * the error is cached and re-thrown on subsequent reads without
     * recomputing. In signalium, when runSignal() throws, the signal's
     * state remains Dirty (because checkSignal never reaches the
     * `signal._state = Clean` line), so every subsequent read recomputes.
     *
     * Impact: Performance — unnecessary recomputation of throwing computeds.
     * Every framework in the ecosystem caches errors; signalium is the outlier.
     */
    test.fails('thrown error is cached and rethrown without recomputing', () => {
      const s = signal('first');

      let computeCount = 0;
      const c = reactive(
        () => {
          computeCount++;
          throw new Error(s.value);
        },
        { desc: 'throwingComputed' },
      );

      const w = watcher(() => {
        try {
          c();
        } catch {
          // ignore
        }
      });
      w.addListener(() => {});

      expect(() => c()).toThrow('first');
      expect(computeCount).toBe(1);

      // Reading again should rethrow cached error without recomputing.
      // ACTUAL: computeCount is 2 (recomputes every time)
      expect(() => c()).toThrow('first');
      expect(computeCount).toBe(1);

      // Changing dependency should produce new error
      s.value = 'second';
      expect(() => c()).toThrow('second');
      expect(computeCount).toBe(2);
    });

    test('thrown non-Error values are handled correctly', () => {
      const s = signal(0);

      const c = reactive(
        () => {
          s.value;
          throw 'string error';
        },
        { desc: 'throwsString' },
      );

      const w = watcher(() => {
        try {
          c();
        } catch {
          // ignore
        }
      });
      w.addListener(() => {});

      expect(() => c()).toThrow('string error');
    });
  });

  describe('error propagation through chains', () => {
    test('error propagates from inner computed to outer', () => {
      const s = signal(0);

      const inner = reactive(
        () => {
          if (s.value < 0) throw new Error('negative');
          return s.value;
        },
        { desc: 'inner' },
      );

      const outer = reactive(
        () => {
          return inner() * 2;
        },
        { desc: 'outer' },
      );

      const w = watcher(() => {
        try {
          outer();
        } catch {
          // ignore
        }
      });
      w.addListener(() => {});

      expect(outer()).toBe(0);

      s.value = -1;
      expect(() => outer()).toThrow('negative');
    });

    test('catching errors from dependencies works correctly', () => {
      const a = signal(0);

      const throwing = reactive(
        () => {
          a.value;
          throw new Error('boom');
        },
        { desc: 'throwing' },
      );

      const catching = reactive(
        () => {
          try {
            throwing();
            return 'no error';
          } catch {
            return 'caught';
          }
        },
        { desc: 'catching' },
      );

      const w = watcher(() => catching());
      w.addListener(() => {});

      expect(catching()).toBe('caught');

      // Changing the throwing computed's source should trigger re-evaluation
      a.value = 1;
      expect(catching()).toBe('caught');
    });
  });

  describe('graph consistency after errors', () => {
    test('sibling computeds still work after one throws', () => {
      const a = signal(0);

      const throws = reactive(
        () => {
          throw new Error('always throws');
        },
        { desc: 'throws' },
      );

      const works = reactive(() => a.value + 1, { desc: 'works' });

      const w = watcher(() => {
        try {
          throws();
        } catch {
          // ignore
        }
        works();
      });
      w.addListener(() => {});

      expect(() => throws()).toThrow('always throws');
      expect(works()).toBe(1);

      a.value = 1;
      expect(works()).toBe(2);
    });

    /**
     * BUG: Error from dependency leaks through checkSignal before consumer's
     * try/catch can handle it.
     *
     * In Preact/Vue/TC39, when a computed reads a throwing dependency
     * inside a try/catch, the error is caught by the consumer's try/catch.
     * In signalium, checkSignal() evaluates dependencies BEFORE running
     * the consumer's compute function. When a dependency throws during
     * checkSignal, the error propagates out of checkSignal(consumer)
     * before the consumer's compute function (with its try/catch) ever
     * executes.
     *
     * Root cause: get.ts checkSignal() line ~100 calls checkSignal(dep)
     * recursively. If the dep throws, the error propagates out of the
     * parent's checkSignal before the parent's compute function runs.
     *
     * Impact: Reactive functions cannot safely wrap throwing dependencies
     * in try/catch when the dependency transitions from non-throwing to
     * throwing state. This also affects watchers — the watcher's pull
     * mechanism doesn't catch errors from dependency evaluation, so the
     * throw becomes an unhandled rejection.
     *
     * This test avoids using a watcher to prevent unhandled rejection noise,
     * but the same bug applies with watchers.
     */
    test.fails('computed recovers after conditional error clears', () => {
      const shouldThrow = signal(false);
      const value = signal(0);

      const maybeThrow = reactive(
        () => {
          if (shouldThrow.value) throw new Error('conditional error');
          return value.value;
        },
        { desc: 'maybeThrow' },
      );

      const downstream = reactive(
        () => {
          try {
            return maybeThrow();
          } catch {
            return -1;
          }
        },
        { desc: 'downstream' },
      );

      expect(downstream()).toBe(0);

      // ACTUAL: error leaks through checkSignal before downstream's
      // try/catch can handle it
      shouldThrow.value = true;
      expect(downstream()).toBe(-1);

      shouldThrow.value = false;
      value.value = 42;
      expect(downstream()).toBe(42);
    });
  });
});
