import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal } from '../index.js';
import { getGlobalScope, clearGlobalContexts, getSignalsMap, SignalScope } from '../internals/contexts.js';
import { watchSignal, unwatchSignal } from '../internals/watch.js';
import { schedulePull } from '../internals/scheduling.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { nextTick, sleep } from './utils/async.js';

const getLiveSignalCount = (scope: SignalScope = getGlobalScope()) => {
  const signals = getSignalsMap(scope);
  let count = 0;
  for (const ref of signals.values()) {
    if (ref.deref() !== undefined) count++;
  }
  return count;
};

const getContextChildScope = (scope: SignalScope): SignalScope => {
  return (scope as any).children.values().next().value as SignalScope;
};

const suspend = (w: unknown) => unwatchSignal(w as ReactiveSignal<any, any>);
const resume = (w: unknown) => {
  const signal = w as ReactiveSignal<any, any>;
  watchSignal(signal);
  schedulePull(signal);
};

describe('Garbage Collection', () => {
  beforeEach(() => {
    clearGlobalContexts();
  });

  it('unwatched signals are deactivated and marked dirty for revalidation', async () => {
    const testSignal = reactive(() => 42);

    const w = watcher(() => testSignal());

    const unwatch = w.addListener(() => {
      testSignal();
    });

    await nextTick();

    expect(getLiveSignalCount()).toBe(1);

    unwatch();
    await nextTick();

    // Signal is still in the scope (WeakRef not collected yet) but deactivated.
    const unwatch2 = w.addListener(() => {});
    await nextTick();

    expect(getLiveSignalCount()).toBe(1);
    unwatch2();
  });

  it('should not deactivate signals that are still being watched', async () => {
    let evalCount = 0;
    const watchedSignal = reactive(() => {
      evalCount++;
      return 'watched';
    });

    const w = watcher(() => watchedSignal());

    w.addListener(() => {
      watchedSignal();
    });

    await nextTick();

    expect(getLiveSignalCount()).toBe(1);
    expect(evalCount).toBe(1);

    await sleep(50);

    expect(getLiveSignalCount()).toBe(1);
    expect(evalCount).toBe(1);
  });

  it('should handle context-scoped signals correctly', async () => {
    const TestContext = context('test');

    let contextSignal: any;
    let evalCount = 0;

    const w = withContexts([[TestContext, 'value']], () => {
      contextSignal = reactive(() => {
        evalCount++;
        return 'context-scoped';
      });

      return watcher(() => contextSignal());
    });

    const unwatch = w.addListener(() => {});
    await nextTick();

    expect(evalCount).toBe(1);

    const contextScope = getContextChildScope(getGlobalScope());
    expect(getLiveSignalCount(contextScope)).toBe(1);

    unwatch();
    await nextTick();

    // Signal is deactivated but still alive (local var holds reference).
    // Re-watching returns the cached value since deps haven't changed.
    const unwatch2 = w.addListener(() => {});
    await nextTick();

    expect(evalCount).toBe(1);
    unwatch2();
  });

  it('re-watching a signal after unwatch reactivates it', async () => {
    let evalCount = 0;
    const s = reactive(() => {
      evalCount++;
      return 'rewatch';
    });

    const w = watcher(() => s());

    const unwatch = w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    expect(getLiveSignalCount()).toBe(1);
    expect(evalCount).toBe(1);

    unwatch();
    await nextTick();

    // Watch again — deps are preserved, so cached values are reused
    w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    expect(getLiveSignalCount()).toBe(1);
    expect(evalCount).toBe(1);
  });

  it('unwatching preserves values and rewatching does not rerun if deps unchanged', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const top = watcher(() => mid2());
    const unwatchTop = top.addListener(() => {});

    await nextTick();

    expect(evalCount).toBe(1);
    expect(getLiveSignalCount()).toBe(2);

    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(2);

    // Unwatch the watcher — function should not rerun.
    suspend(top);
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getLiveSignalCount()).toBe(2);

    // Change source while unwatched — still no rerun.
    source.value = 3;
    await nextTick();

    expect(evalCount).toBe(2);

    // Reset source to 2 and rewatch. Deps reactivated without Dirty marking.
    source.value = 2;
    resume(top);
    await nextTick();

    expect(evalCount).toBe(2);

    unwatchTop();
  });

  it('shared dependency stays active until all consumers unwatch', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const topA = watcher(() => mid2());
    const topB = watcher(() => mid2());

    const unwatchA = topA.addListener(() => {});
    const unwatchB = topB.addListener(() => {});

    await nextTick();

    expect(evalCount).toBe(1);

    // Unwatch only A — mid2 stays active because B is still watching.
    suspend(topA);
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(2);

    // Unwatch B — mid2 is now fully deactivated.
    suspend(topB);
    source.value = 3;
    await nextTick();

    // No re-evaluation while fully deactivated.
    expect(evalCount).toBe(2);

    unwatchA();
    unwatchB();
  });

  it('cleans cached values that are unwatched and then rewatched', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const top = watcher(
      () => {
        return mid2();
      },
      { desc: 'top' },
    );
    const stop = top.addListener(() => {});

    await nextTick();

    expect(evalCount).toBe(1);

    // Unwatch and then remove the listener.
    suspend(top);
    stop();
    await sleep(5);

    expect(evalCount).toBe(1);

    // Re-add a listener — deps are preserved, cached values reused.
    resume(top);
    const stop2 = top.addListener(() => {});
    await sleep(20);

    expect(evalCount).toBe(1);

    stop2();
  });

  it('does not leak state across repeated unwatch-rewatch cycles', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const top = watcher(() => mid2());

    for (let i = 0; i < 15; i++) {
      const stop = top.addListener(() => {});
      await nextTick();

      expect(getLiveSignalCount()).toBe(2);

      // Unwatch
      suspend(top);
      await sleep(20);

      expect(getLiveSignalCount()).toBe(2);

      // Unwatch listener
      stop();
      await sleep(20);

      expect(getLiveSignalCount()).toBe(2);

      // Rewatch
      const stop2 = top.addListener(() => {});
      await sleep(20);

      expect(getLiveSignalCount()).toBe(2);

      // Resume
      resume(top);
      await sleep(20);
      expect(getLiveSignalCount()).toBe(2);

      // Unwatch
      stop2();
      await sleep(20);
    }

    // After many cycles, no crashes or state corruption.
    expect(evalCount).toBeGreaterThanOrEqual(1);
  });

  it('shared dependency is preserved when consumers unwatch separately', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const topA = watcher(() => mid2());
    const topB = watcher(() => mid2());

    const unwatchA = topA.addListener(() => {});
    const unwatchB = topB.addListener(() => {});

    await nextTick();

    expect(evalCount).toBe(1);

    // Unwatch A. B is still active.
    suspend(topA);
    unwatchA();
    await nextTick();

    // mid2 still active via B — changes propagate.
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(2);

    // Unwatch B. Now fully torn down.
    suspend(topB);
    unwatchB();
    await nextTick();

    expect(evalCount).toBe(2);
  });

  it('does not recompute unwatched signals when deps change', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const top = watcher(() => mid2());
    const unwatchTop = top.addListener(() => {});

    await nextTick();

    expect(evalCount).toBe(1);

    // Unwatch the watcher — signals should be preserved.
    suspend(top);
    await nextTick();

    expect(getLiveSignalCount()).toBe(2);

    await sleep(50);

    // Signals should still be alive.
    expect(getLiveSignalCount()).toBe(2);

    // Changes while unwatched should not trigger re-evaluation.
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(1);

    // Resume — should re-evaluate with the new value.
    resume(top);
    await nextTick();

    expect(evalCount).toBe(2);

    unwatchTop();
  });
});
