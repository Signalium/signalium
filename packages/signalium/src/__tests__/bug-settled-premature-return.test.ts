import { describe, expect, test } from 'vitest';
import { signal, watcher, settled } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Bug: settled() returns before async reactive computations finish', () => {
  test('settled() should wait for async reactive with real async work', async () => {
    const src = signal(0);

    const asyncData = reactive(
      async () => {
        const v = src.value;
        await sleep(10); // simulates fetch, setTimeout, etc.
        return v;
      },
      { desc: 'asyncData' },
    );

    const w = watcher(() => asyncData());
    w.addListener(() => {});

    // Initial resolution
    await sleep(20);
    expect(asyncData().value).toBe(0);

    // Change signal and wait via settled()
    src.value = 42;
    await settled();

    // settled() only waits for PENDING_PULLS/PENDING_ASYNC_PULLS to drain.
    // The async reactive's setTimeout is NOT tracked by the pull queue,
    // so settled() returns before the computation finishes.
    const result = asyncData();
    expect(result.isResolved).toBe(true); // FAILS: still isPending
    expect(result.value).toBe(42);
  });

  test('settled() should wait for multiple concurrent async chains', async () => {
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

    await sleep(30);

    src.value = 5;
    await settled();

    // Both chains still pending after settled() returns
    expect(chain1().isResolved).toBe(true); // FAILS
    expect(chain1().value).toBe(10);
    expect(chain2().isResolved).toBe(true); // FAILS
    expect(chain2().value).toBe(15);
  });
});
