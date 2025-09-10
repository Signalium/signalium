import { describe, expect, test } from 'vitest';
import { notifier, reactive, signal, watcher } from '../index.js';
import { nextTick } from './utils/async.js';

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
});
