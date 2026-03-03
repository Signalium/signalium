import { describe, expect, test } from 'vitest';
import { notifier, signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { sleep } from './utils/async.js';

describe('async reactive stays pending forever when notifier and signal change concurrently', () => {
  test('3-level async chain with concurrent notifier + signal change', async () => {
    const n = notifier();
    const entity = signal(100);
    const storage = signal('data');

    const level0 = reactive(
      async () => {
        n.consume();
        await sleep(10);
        return storage.value;
      },
      { desc: 'level0' },
    );

    const level1 = reactive(
      async () => {
        return await level0();
      },
      { desc: 'level1' },
    );

    const level2 = reactive(
      async () => {
        return await level1();
      },
      { desc: 'level2' },
    );

    const consumer = reactive(
      async () => {
        const chainValue = await level2();
        const entityValue = entity.value;
        return `${chainValue}-${entityValue}`;
      },
      { desc: 'consumer' },
    );

    const w = watcher(() => consumer());
    w.addListener(() => {});
    await sleep(50);

    const initial = consumer();
    expect(initial.isResolved).toBe(true);
    expect(initial.value).toBe('data-100');

    // Notify (dirties the chain but value stays the same) and change
    // the entity signal at the same time
    n.notify();
    entity.value = 200;

    await sleep(200);

    const result = consumer();
    expect(result.isPending).toBe(false);
    expect(result.isResolved).toBe(true);
    expect(result.value).toBe('data-200');
  });

  test('2-level async chain works fine (control)', async () => {
    const n = notifier();
    const entity = signal(1);
    const storage = signal('account-A');

    const inner = reactive(
      async () => {
        n.consume();
        await sleep(10);
        return storage.value;
      },
      { desc: 'inner' },
    );

    const outer = reactive(
      async () => {
        const account = await inner();
        const e = entity.value;
        return `${account}:${e}`;
      },
      { desc: 'outer' },
    );

    const w = watcher(() => outer());
    w.addListener(() => {});
    await sleep(50);

    const initial = outer();
    expect(initial.isResolved).toBe(true);
    expect(initial.value).toBe('account-A:1');

    n.notify();
    entity.value = 2;

    await sleep(200);

    const result = outer();
    expect(result.isPending).toBe(false);
    expect(result.isResolved).toBe(true);
    expect(result.value).toBe('account-A:2');
  });
});
