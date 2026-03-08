import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Bug: removing last watcher mid-flight loses async result', () => {
  /**
   * After removing the last watcher while an async reactive is
   * mid-computation, reading the reactive function returns
   * value === undefined instead of the last resolved value.
   *
   * This models a React component unmounting while data is loading,
   * then re-mounting and expecting to see the last known value.
   */
  test('should preserve last value after watcher removal during async computation', async () => {
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

    // Watch and wait for initial resolution
    const w = watcher(() => asyncComputed());
    const unsub = w.addListener(() => {});
    await sleep(30);
    expect(asyncComputed().value).toBe(2);

    // Trigger recomputation
    src.value = 2;

    // Remove watcher while async is mid-flight (at the await sleep(20))
    await sleep(5);
    unsub();

    // Wait for async to finish
    await sleep(30);

    // Reading the reactive should return either the new value (4)
    // or at minimum the last known value (2). It should NOT be undefined.
    const result = asyncComputed();
    expect(result.value === 2 || result.value === 4).toBe(true); // FAILS: value is undefined
  });
});
