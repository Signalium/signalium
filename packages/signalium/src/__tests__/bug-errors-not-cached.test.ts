import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

describe('Bug: computed errors are not cached', () => {
  test('thrown error should be cached and rethrown without recomputing', () => {
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
        // swallow
      }
    });
    w.addListener(() => {});

    // First read: computes and throws
    expect(() => c()).toThrow('first');
    expect(computeCount).toBe(1);

    // Second read with no dependency change: should rethrow cached error
    // without recomputing. In Preact Signals, Vue, and TC39 polyfill,
    // computeCount stays at 1. In signalium, it increments to 2.
    expect(() => c()).toThrow('first');
    expect(computeCount).toBe(1); // FAILS: actual is 2

    // After a dependency change, recompute is expected
    s.value = 'second';
    expect(() => c()).toThrow('second');
    expect(computeCount).toBe(2);
  });
});
