import { describe, expect, test } from 'vitest';
import { signal, watcher, notifier, settled } from 'signalium';
import { reactive, relay } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

describe('async concurrency edge cases', () => {
  describe('async diamond dependencies', () => {
    test('two async branches from same source converge in a consumer', async () => {
      const src = signal(1);

      const left = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 2;
        },
        { desc: 'left' },
      );

      const right = reactive(
        async () => {
          const v = src.value;
          await sleep(15);
          return v * 3;
        },
        { desc: 'right' },
      );

      const consumer = reactive(
        async () => {
          const l = await left();
          const r = await right();
          return l + r;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});

      await sleep(50);
      const r1 = consumer();
      expect(r1.isResolved).toBe(true);
      expect(r1.value).toBe(5); // 1*2 + 1*3

      src.value = 2;
      await sleep(50);

      const r2 = consumer();
      expect(r2.isPending).toBe(false);
      expect(r2.isResolved).toBe(true);
      expect(r2.value).toBe(10); // 2*2 + 2*3
    });

    test('async diamond where one branch resolves faster than the other', async () => {
      const src = signal(1);

      const fast = reactive(
        async () => {
          const v = src.value;
          await sleep(5);
          return v * 10;
        },
        { desc: 'fast' },
      );

      const slow = reactive(
        async () => {
          const v = src.value;
          await sleep(30);
          return v * 100;
        },
        { desc: 'slow' },
      );

      const consumer = reactive(
        async () => {
          const f = await fast();
          const s = await slow();
          return f + s;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});

      await sleep(60);
      expect(consumer().value).toBe(110); // 10 + 100

      // Change source while slow branch is still resolving
      src.value = 2;
      await sleep(10); // fast resolves, slow still pending

      // The consumer should not show partially updated results
      const mid = consumer();
      // It should still be pending or show old value
      expect(mid.value === 110 || mid.isPending).toBe(true);

      await sleep(80);
      expect(consumer().value).toBe(220); // 20 + 200
    });

    test('async diamond with notifier dirtying one branch mid-resolution', async () => {
      const n = notifier();
      const src = signal(1);

      const branch1 = reactive(
        async () => {
          n.consume();
          const v = src.value;
          await sleep(10);
          return v;
        },
        { desc: 'branch1' },
      );

      const branch2 = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 10;
        },
        { desc: 'branch2' },
      );

      const consumer = reactive(
        async () => {
          const b1 = await branch1();
          const b2 = await branch2();
          return b1 + b2;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});

      await sleep(50);
      expect(consumer().isResolved).toBe(true);
      expect(consumer().value).toBe(11); // 1 + 10

      // Notify branch1 (dirties it) and change src simultaneously
      n.notify();
      src.value = 2;

      await sleep(100);

      const result = consumer();
      expect(result.isPending).toBe(false);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(22); // 2 + 20
    });
  });

  describe('rapid mutations during async resolution', () => {
    test('rapid signal changes while async chain is pending', async () => {
      const src = signal(0);

      const inner = reactive(
        async () => {
          const v = src.value;
          await sleep(20);
          return v;
        },
        { desc: 'inner' },
      );

      const outer = reactive(
        async () => {
          return await inner();
        },
        { desc: 'outer' },
      );

      const w = watcher(() => outer());
      w.addListener(() => {});

      await sleep(50);
      expect(outer().value).toBe(0);

      // Rapidly change the signal 10 times
      for (let i = 1; i <= 10; i++) {
        src.value = i;
      }

      // Should eventually settle to the last value
      await sleep(100);
      const result = outer();
      expect(result.isPending).toBe(false);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(10);
    });

    test('signal changes between two awaits in the same reactive', async () => {
      const a = signal(1);
      const b = signal(10);

      const inner1 = reactive(
        async () => {
          const v = a.value;
          await sleep(10);
          return v;
        },
        { desc: 'inner1' },
      );

      const inner2 = reactive(
        async () => {
          const v = b.value;
          await sleep(10);
          return v;
        },
        { desc: 'inner2' },
      );

      const combined = reactive(
        async () => {
          const v1 = await inner1();
          // b changes while we're between awaits
          const v2 = await inner2();
          return v1 + v2;
        },
        { desc: 'combined' },
      );

      const w = watcher(() => combined());
      w.addListener(() => {});

      await sleep(50);
      expect(combined().value).toBe(11);

      // Change b while inner1 is being awaited
      a.value = 2;
      await sleep(5); // inner1 is mid-resolution
      b.value = 20; // change b before inner2 is reached

      await sleep(100);
      const result = combined();
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(22); // 2 + 20
    });
  });

  describe('watcher listener re-entrancy', () => {
    test('listener that modifies a signal triggers another cycle', async () => {
      const src = signal(0);
      const derived = reactive(() => src.value * 2, { desc: 'derived' });

      let listenerCallCount = 0;
      const w = watcher(() => derived());
      w.addListener(() => {
        listenerCallCount++;
        if (src.value === 1) {
          src.value = 2; // re-entrant write
        }
      });

      expect(derived()).toBe(0);

      src.value = 1;
      await settled();

      // The listener fires for value=1, writes value=2, which should trigger another cycle
      expect(derived()).toBe(4); // 2 * 2
    });

    test('two watchers with listener that modifies shared signal', async () => {
      const src = signal(0);
      const a = reactive(() => src.value + 1, { desc: 'a' });
      const b = reactive(() => src.value * 10, { desc: 'b' });

      const aValues: number[] = [];
      const bValues: number[] = [];

      const w1 = watcher(() => a());
      w1.addListener(() => {
        aValues.push(a() as number);
      });

      const w2 = watcher(() => b());
      w2.addListener(() => {
        bValues.push(b() as number);
      });

      src.value = 1;
      await settled();

      expect(a()).toBe(2);
      expect(b()).toBe(10);
    });
  });

  describe('settled() edge cases', () => {
    /**
     * BUG: settled() does not wait for async reactive computations to finish.
     *
     * settled() only waits for the scheduler's pull queue (PENDING_PULLS,
     * PENDING_ASYNC_PULLS) to drain. But async reactive functions that
     * perform real async work (setTimeout, fetch, etc.) schedule their
     * resolution independently via promise callbacks, which are NOT
     * tracked by the pull queue.
     *
     * When a signal changes, the watcher schedules a pull. flushWatchers
     * runs the pull (which starts the async computation), then the pull
     * queue is empty, so flushWatchers resolves. But the async computation
     * is still running in the background.
     *
     * Impact: Code using `await settled()` to wait for data to be ready
     * will get stale/pending results. The only reliable way to wait is
     * `await sleep(N)`, which is fragile.
     */
    test.fails('settled() resolves after deeply nested async chain completes', async () => {
      const src = signal(0);

      let current: () => any = reactive(
        async () => {
          const v = src.value;
          await sleep(5);
          return v;
        },
        { desc: 'base' },
      );

      for (let i = 0; i < 5; i++) {
        const prev = current;
        current = reactive(
          async () => {
            return await prev();
          },
          { desc: `level${i}` },
        );
      }

      const tail = current;
      const w = watcher(() => tail());
      w.addListener(() => {});

      src.value = 42;
      await settled();

      // ACTUAL: tail is still pending — settled() returned before
      // the async computation completed
      const result = tail();
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(42);
    });

    test.fails('settled() handles multiple concurrent async chains', async () => {
      const src = signal(1);

      const chain1 = reactive(
        async () => {
          const v = src.value;
          await sleep(10);
          return v * 2;
        },
        { desc: 'chain1' },
      );

      const chain2 = reactive(
        async () => {
          const v = src.value;
          await sleep(20);
          return v * 3;
        },
        { desc: 'chain2' },
      );

      const w1 = watcher(() => chain1());
      w1.addListener(() => {});
      const w2 = watcher(() => chain2());
      w2.addListener(() => {});

      src.value = 5;
      await settled();

      // ACTUAL: both chains still pending — settled() returned
      // before async work completed
      expect(chain1().isResolved).toBe(true);
      expect(chain1().value).toBe(10);
      expect(chain2().isResolved).toBe(true);
      expect(chain2().value).toBe(15);
    });
  });

  describe('deep async chain pending bug (clearPending)', () => {
    /**
     * BUG: Async reactive stays permanently pending when a notifier and
     * signal change concurrently in chains deeper than 2 levels.
     *
     * The existing clearPending-awaitSubs.test.ts shows this with 3 levels.
     * These tests confirm the bug scales — 4 and 5 level chains also fail.
     *
     * Root cause: When a notifier fires (dirtying the chain) and a signal
     * changes simultaneously, the pending state from the async chain
     * is never cleared. The consumer gets stuck with isPending=true forever.
     */
    test.fails('4-level chain with notifier + signal change (extending clearPending bug)', async () => {
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

      const level3 = reactive(
        async () => {
          return await level2();
        },
        { desc: 'level3' },
      );

      const consumer = reactive(
        async () => {
          const chainValue = await level3();
          const entityValue = entity.value;
          return `${chainValue}-${entityValue}`;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});
      await sleep(100);

      const initial = consumer();
      expect(initial.isResolved).toBe(true);
      expect(initial.value).toBe('data-100');

      n.notify();
      entity.value = 200;

      await sleep(300);

      const result = consumer();
      expect(result.isPending).toBe(false);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe('data-200');
    });

    test.fails('5-level chain with notifier + signal change', async () => {
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
      for (let i = 1; i <= 4; i++) {
        const prev = current;
        current = reactive(
          async () => {
            return await prev();
          },
          { desc: `level${i}` },
        );
      }

      const level4 = current;

      const consumer = reactive(
        async () => {
          const chainValue = await level4();
          const entityValue = entity.value;
          return `${chainValue}-${entityValue}`;
        },
        { desc: 'consumer' },
      );

      const w = watcher(() => consumer());
      w.addListener(() => {});
      await sleep(100);

      const initial = consumer();
      expect(initial.isResolved).toBe(true);
      expect(initial.value).toBe('data-100');

      n.notify();
      entity.value = 200;

      await sleep(300);

      const result = consumer();
      expect(result.isPending).toBe(false);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe('data-200');
    });
  });

  describe('async with dynamic dependencies', () => {
    test('async reactive that conditionally reads different signals', async () => {
      const cond = signal(true);
      const a = signal('A');
      const b = signal('B');

      const fetcher = reactive(
        async () => {
          const useCond = cond.value;
          await sleep(10);
          return useCond ? a.value : b.value;
        },
        { desc: 'fetcher' },
      );

      const w = watcher(() => fetcher());
      w.addListener(() => {});

      await sleep(30);
      expect(fetcher().value).toBe('A');

      // Change inactive branch — should not trigger
      b.value = 'B2';
      await sleep(30);
      expect(fetcher().value).toBe('A');

      // Switch branch
      cond.value = false;
      await sleep(30);
      expect(fetcher().value).toBe('B2');

      // Old branch should be inactive now
      a.value = 'A2';
      await sleep(30);
      expect(fetcher().value).toBe('B2');
    });

    test('async reactive reads signal before await, different signal after', async () => {
      const before = signal(1);
      const after = signal(10);

      const combined = reactive(
        async () => {
          const v1 = before.value;
          await sleep(10);
          const v2 = after.value;
          return v1 + v2;
        },
        { desc: 'combined' },
      );

      const w = watcher(() => combined());
      w.addListener(() => {});

      await sleep(30);
      expect(combined().value).toBe(11);

      // Change signal read after await
      after.value = 20;
      await sleep(30);
      expect(combined().value).toBe(21);

      // Change signal read before await
      before.value = 2;
      await sleep(30);
      expect(combined().value).toBe(22);

      // Change both
      before.value = 3;
      after.value = 30;
      await sleep(30);
      expect(combined().value).toBe(33);
    });
  });

  describe('relay + async interaction', () => {
    test('relay deactivation while async consumer is pending', async () => {
      const relaySignal = relay<number>(
        state => {
          state.value = 42;
          return {
            update: () => {},
            deactivate: () => {},
          };
        },
        { desc: 'testRelay' },
      );

      const getRelay = reactive(
        async () => {
          return relaySignal.value;
        },
        { desc: 'getRelay' },
      );

      const consumer = reactive(
        async () => {
          const v = await getRelay();
          await sleep(20);
          return v;
        },
        { desc: 'consumer' },
      );

      // Start watching
      expect(consumer).toHaveSignalValue(undefined);
      await sleep(50);
      expect(consumer).toHaveSignalValue(42);
      expect(relaySignal).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
    });

    test('relay value changes while async consumer awaits another dep', async () => {
      const trigger = signal(0);
      const relayVal = signal(100);

      const testRelay = relay<number>(
        state => {
          state.value = relayVal.value;
          return {
            update: () => {
              state.value = relayVal.value;
            },
            deactivate: () => {},
          };
        },
        { desc: 'testRelay' },
      );

      const getRelay = reactive(
        async () => {
          return testRelay.value;
        },
        { desc: 'getRelay' },
      );

      const slowDep = reactive(
        async () => {
          const v = trigger.value;
          await sleep(20);
          return v;
        },
        { desc: 'slowDep' },
      );

      const consumer = reactive(
        async () => {
          const s = await slowDep();
          const r = await getRelay();
          return `${s}-${r}`;
        },
        { desc: 'consumer' },
      );

      expect(consumer).toHaveSignalValue(undefined);
      await sleep(50);
      expect(consumer).toHaveSignalValue('0-100');

      // Change relay value while slowDep is resolving
      trigger.value = 1;
      await sleep(5);
      relayVal.value = 200;

      await sleep(80);
      const result = consumer();
      expect(result.isResolved).toBe(true);
      // Should have the latest relay value
      expect(result.value).toBe('1-200');
    });
  });

  describe('notifier edge cases', () => {
    test('multiple rapid notifier fires with async chain', async () => {
      const n = notifier();
      const data = signal('initial');

      let computeCount = 0;
      const fetcher = reactive(
        async () => {
          computeCount++;
          n.consume();
          await sleep(10);
          return data.value;
        },
        { desc: 'fetcher' },
      );

      const w = watcher(() => fetcher());
      w.addListener(() => {});

      await sleep(30);
      expect(fetcher().value).toBe('initial');
      const countAfterInit = computeCount;

      // Fire notifier multiple times rapidly
      n.notify();
      n.notify();
      n.notify();

      await sleep(50);
      expect(fetcher().value).toBe('initial');
      expect(fetcher().isResolved).toBe(true);
    });

    test('notifier + data change in async chain with intermediate sync reactive', async () => {
      const n = notifier();
      const src = signal(1);

      const asyncFetcher = reactive(
        async () => {
          n.consume();
          await sleep(10);
          return src.value;
        },
        { desc: 'asyncFetcher' },
      );

      // Sync reactive that reads the async result
      const syncDerived = reactive(
        () => {
          const result = asyncFetcher();
          return result.isResolved ? result.value! * 2 : 0;
        },
        { desc: 'syncDerived' },
      );

      const w = watcher(() => syncDerived());
      w.addListener(() => {});

      await sleep(30);
      expect(syncDerived()).toBe(2); // 1 * 2

      n.notify();
      src.value = 5;

      await sleep(50);
      expect(syncDerived()).toBe(10); // 5 * 2
    });
  });
});
