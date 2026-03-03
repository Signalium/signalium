import { describe, expect, test } from 'vitest';
import { signal, watcher, notifier } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Bug: deep async chain permanently stuck pending with concurrent notifier + signal change', () => {
  /**
   * When a notifier and a signal change concurrently in an async chain
   * 3 or more levels deep, the consumer gets permanently stuck with
   * isPending === true. Works fine at depth 2.
   *
   * This is a real-world scenario: a WebSocket notification (notifier)
   * and a user action (signal change) happening at the same time will
   * permanently break any reactive chain with 3+ async levels.
   */
  test('2-level chain works fine (control)', async () => {
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

    const consumer = reactive(
      async () => {
        const chainValue = await level0();
        const entityValue = entity.value;
        return `${chainValue}-${entityValue}`;
      },
      { desc: 'consumer' },
    );

    const w = watcher(() => consumer());
    w.addListener(() => {});
    await sleep(50);

    expect(consumer().isResolved).toBe(true);
    expect(consumer().value).toBe('data-100');

    n.notify();
    entity.value = 200;
    await sleep(100);

    expect(consumer().isPending).toBe(false);
    expect(consumer().value).toBe('data-200');
  });

  test.each([3, 4, 5])(
    '%i-level chain gets permanently stuck pending',
    async (depth: number) => {
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

      let current: () => any = level0;
      for (let i = 1; i < depth; i++) {
        const prev = current;
        current = reactive(
          async () => await prev(),
          { desc: `level${i}` },
        );
      }

      const chain = current;
      const consumer = reactive(
        async () => {
          const chainValue = await chain();
          const entityValue = entity.value;
          return `${chainValue}-${entityValue}`;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});
      await sleep(depth * 20 + 50);

      expect(consumer().isResolved).toBe(true);
      expect(consumer().value).toBe('data-100');

      // Concurrent notifier + signal change
      n.notify();
      entity.value = 200;

      await sleep(depth * 20 + 200);

      // FAILS at depth >= 3: consumer is permanently stuck with isPending === true
      expect(consumer().isPending).toBe(false);
      expect(consumer().isResolved).toBe(true);
      expect(consumer().value).toBe('data-200');
    },
    15000,
  );
});
