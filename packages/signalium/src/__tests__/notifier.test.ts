import { describe, expect, test } from 'vitest';
import { notifier, reactive, reactiveSignal, signal, watcher } from '../index.js';
import { nextTick } from './utils/async.js';

describe('addListener with skipInitial', () => {
  test('skips the initial listener callback when skipInitial is true', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let calls = 0;
    const stop = w.addListener(
      () => {
        calls++;
      },
      { skipInitial: true },
    );

    await nextTick();
    expect(calls).toBe(0);

    s.value = 100;
    await nextTick();
    expect(calls).toBe(1);

    stop();
  });

  test('fires the initial listener callback by default', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let calls = 0;
    const stop = w.addListener(() => {
      calls++;
    });

    await nextTick();
    expect(calls).toBe(1);

    s.value = 100;
    await nextTick();
    expect(calls).toBe(2);

    stop();
  });

  test('supports mixed listeners with and without skipInitial', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let normalCalls = 0;
    let skipCalls = 0;

    const stop1 = w.addListener(() => {
      normalCalls++;
    });
    const stop2 = w.addListener(
      () => {
        skipCalls++;
      },
      { skipInitial: true },
    );

    await nextTick();
    expect(normalCalls).toBe(1);
    expect(skipCalls).toBe(0);

    s.value = 100;
    await nextTick();
    expect(normalCalls).toBe(2);
    expect(skipCalls).toBe(1);

    stop1();
    stop2();
  });

  test('deduplicates the same listener even with skipInitial', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let calls = 0;
    const cb = () => {
      calls++;
    };

    const stop1 = w.addListener(cb, { skipInitial: true });
    const stop2 = w.addListener(cb, { skipInitial: true });

    await nextTick();
    expect(calls).toBe(0);

    s.value = 100;
    await nextTick();
    expect(calls).toBe(1);

    stop1();
    stop2();
  });

  test('deduplicates when same callback is added with and without skipInitial', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let calls = 0;
    const cb = () => {
      calls++;
    };

    const stop1 = w.addListener(cb);
    const stop2 = w.addListener(cb, { skipInitial: true });

    await nextTick();
    expect(calls).toBe(1);

    s.value = 100;
    await nextTick();
    expect(calls).toBe(2);

    stop1();
    stop2();
  });

  test('re-adding after removal resets the skip', async () => {
    const s = signal(42);
    const w = watcher(() => s.value);

    let calls = 0;
    const cb = () => {
      calls++;
    };

    const stop1 = w.addListener(cb, { skipInitial: true });
    await nextTick();
    expect(calls).toBe(0);

    s.value = 100;
    await nextTick();
    expect(calls).toBe(1);

    stop1();

    const stop2 = w.addListener(cb, { skipInitial: true });
    await nextTick();
    expect(calls).toBe(1);

    s.value = 200;
    await nextTick();
    expect(calls).toBe(2);

    stop2();
  });
});

describe('notifier', () => {
  test('invalidates a reactive function when notified', () => {
    const n = notifier();

    let count = 0;

    const get = reactive(() => {
      n.consume();
      return count;
    });

    expect(get()).toBe(0);

    count = 1;
    // No change yet since notifier wasn't notified
    expect(get()).toBe(0);

    n.notify();
    expect(get()).toBe(1);
  });

  test('can be used with watchers to propagate notifications', async () => {
    const n = notifier();
    const s = signal(0);

    const get = reactive(() => {
      n.consume();
      return s.value;
    });

    let calls = 0;
    const w = watcher(() => get());
    const stop = w.addListener(() => {
      calls++;
    });

    // Initial activation produces no listener call until something changes
    expect(calls).toBe(0);

    // Update unrelated signal (not consumed) doesn't update
    s.value = 1; // get hasn't been recomputed since notifier didn't fire
    expect(calls).toBe(0);

    // Notify causes recomputation and listener call
    n.notify();
    await nextTick();
    expect(calls).toBe(1);

    stop();
  });

  test('notify() dirties all consumers when there are multiple', async () => {
    const n = notifier();
    let count1 = 0,
      count2 = 0,
      count3 = 0;

    const a = reactiveSignal(() => {
      n.consume();
      count1++;
      return 'a';
    });

    const b = reactiveSignal(() => {
      n.consume();
      count2++;
      return 'b';
    });

    const c = reactiveSignal(() => {
      n.consume();
      count3++;
      return 'c';
    });

    const unsub1 = (a as any).addListener(() => {});
    const unsub2 = (b as any).addListener(() => {});
    const unsub3 = (c as any).addListener(() => {});

    expect(a.value).toBe('a');
    expect(b.value).toBe('b');
    expect(c.value).toBe('c');
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    expect(count3).toBe(1);

    n.notify();
    await nextTick();

    expect(count1).toBe(2);
    expect(count2).toBe(2);
    expect(count3).toBe(2);

    unsub1();
    unsub2();
    unsub3();
  });
});
