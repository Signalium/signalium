import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal } from '../index.js';
import { SignalScope, getGlobalScope, clearGlobalContexts } from '../internals/contexts.js';
import { nextTick, sleep } from './utils/async.js';

// Helper to access private properties for testing
const getSignalsMap = (scope: SignalScope) => {
  return (scope as any).signals as Map<number, any>;
};

const getGCCandidates = (scope: SignalScope) => {
  return (scope as any).gcCandidates as Set<any>;
};

const getContextChildScope = (scope: SignalScope): SignalScope => {
  return (scope as any).children.values().next().value as SignalScope;
};

describe('Garbage Collection', () => {
  beforeEach(() => {
    clearGlobalContexts();
  });

  it('should automatically garbage collect unwatched signals', async () => {
    const testSignal = reactive(() => 42);

    const w = watcher(() => testSignal());

    // Watch the signal
    const unwatch = w.addListener(() => {
      testSignal();
    });

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(getGlobalScope()).size).toBe(1);

    // Unwatch the signal
    unwatch();

    await sleep(50);

    // Signal should be garbage collected
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('should not garbage collect signals that are still being watched', async () => {
    // Create a signal
    const watchedSignal = reactive(() => 'watched');

    const w = watcher(() => watchedSignal());

    // Watch the signal but don't unwatch
    w.addListener(() => {
      watchedSignal();
    });

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(getGlobalScope()).size).toBe(1);

    await sleep(50);

    // Signal should still be in the scope because it's being watched
    expect(getSignalsMap(getGlobalScope()).size).toBe(1);
  });

  it('should handle context-scoped signals correctly', async () => {
    // Create a context
    const TestContext = context('test');

    // Create signals in context
    let contextSignal: any;

    withContexts([[TestContext, 'value']], () => {
      contextSignal = reactive(() => 'context-scoped');

      const w = watcher(() => contextSignal());

      // Watch and unwatch
      const unwatch = w.addListener(() => {
        contextSignal();
      });

      unwatch();
    });

    await nextTick();

    // Get the context scope (this is a bit hacky for testing)
    const contextScope = getContextChildScope(getGlobalScope());

    await sleep(50);

    // Signal should be garbage collected from the context scope
    expect(getSignalsMap(contextScope).size).toBe(0);
  });

  it('should remove signal from GC candidates if watched again', async () => {
    // Create a signal
    const signal = reactive(() => 'rewatch');

    const w = watcher(() => signal());

    // Watch and unwatch
    const unwatch = w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(getGlobalScope()).size).toBe(1);

    unwatch();
    await nextTick();

    // Signal should be in GC candidates
    expect(getGCCandidates(getGlobalScope()).size).toBe(2);

    // Watch again
    w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    // Signal should be removed from GC candidates
    expect(getSignalsMap(getGlobalScope()).size).toBe(1);
    expect(getGCCandidates(getGlobalScope()).size).toBe(0);
  });

  it('propagates suspension to dependencies and tears them down without GC', async () => {
    // Track how many times our reactive function reruns.
    let evalCount = 0;

    const source = signal(1);

    // Direct consumers of a signal always rerun when it changes. So we
    // need a _second_ reactive function to observe caching behavior.
    const mid1 = reactive(() => source.value + 1);

    // This second function increments the counter. It will _not_ rerun
    // if `mid1`'s output hasn't changed.
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    const top = watcher(() => mid2());

    const unwatchTop = top.addListener(() => {});

    // Wait for initial activation.
    await nextTick();

    expect(evalCount).toBe(1);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Verify the counter works by changing source.
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend the Watcher — function should not rerun.
    top.setSuspended(true);
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Change source while suspended — still no rerun.
    source.value = 3;
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Reset source to 2 and resume. The _output_ of `mid1` is still
    // 2 + 1 = 3, unchanged. So `mid2` should NOT rerun if cached.
    //
    // If `mid2` had been GC'd, it would have to be recreated, and the
    // counter would increment.
    source.value = 2;
    top.setSuspended(false);
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Fully unwatch — counter should remain unchanged.
    unwatchTop();
    await sleep(20);

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('shared dependency stays active until all consumers suspend', async () => {
    // Track how many times mid2 re-evaluates.
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    // Two watchers share the same dependency chain.
    const topA = watcher(() => mid2());
    const topB = watcher(() => mid2());

    const unwatchA = topA.addListener(() => {});
    const unwatchB = topB.addListener(() => {});

    await nextTick();

    // Both watchers share mid2 — it evaluates once.
    expect(evalCount).toBe(1);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend only A — mid2 stays active because B is still watching.
    topA.setSuspended(true);
    source.value = 2;
    await nextTick();

    // mid2 re-evaluates because B is still active.
    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend B — mid2 is now fully suspended.
    topB.setSuspended(true);
    source.value = 3;
    await nextTick();

    // No re-evaluation while fully suspended.
    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Unwatch both — signals should be cleaned up.
    unwatchA();
    unwatchB();
    await sleep(20);

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('cleans cached values that are suspended and then unwatched', async () => {
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
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend and then remove the listener.
    top.setSuspended(true);
    stop();
    await sleep(5);

    // Signals should be garbage collected.
    expect(evalCount).toBe(1);
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);

    // Re-add a listener — should re-evaluate.
    top.setSuspended(false);
    const stop2 = top.addListener(() => {});
    await sleep(20);

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Clean up.
    stop2();
    await sleep(20);

    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('does not leak state across repeated suspend-unwatch cycles', async () => {
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

      expect(getSignalsMap(getGlobalScope()).size).toBe(2);

      // Suspend
      top.setSuspended(true);
      await sleep(20);

      expect(getSignalsMap(getGlobalScope()).size).toBe(2);

      // Unwatch
      stop();
      await sleep(20);

      expect(getSignalsMap(getGlobalScope()).size).toBe(0);

      // Rewatch
      const stop2 = top.addListener(() => {});
      await sleep(20);

      expect(getSignalsMap(getGlobalScope()).size).toBe(2);

      // Resume
      top.setSuspended(false);
      await sleep(20);
      expect(getSignalsMap(getGlobalScope()).size).toBe(2);

      // Unwatch
      stop2();
      await sleep(20);
      expect(getSignalsMap(getGlobalScope()).size).toBe(0);
    }

    // After many cycles, all signals should be properly cleaned up.
    await sleep(50);

    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('shared dependency is preserved when consumers suspend and unwatch separately', async () => {
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
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend and unwatch A. B is still active.
    topA.setSuspended(true);
    unwatchA();
    await nextTick();

    // mid2 still active via B — changes propagate.
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend and unwatch B. Now fully torn down.
    topB.setSuspended(true);
    unwatchB();
    await nextTick();

    // Signals are still in the map right after deactivation — GC sweep
    // hasn't run yet.
    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Allow GC sweep to run — signals should now be cleaned up.
    await sleep(50);

    expect(evalCount).toBe(2);
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });

  it('does not garbage collect signals while suspended', async () => {
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
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Suspend the watcher — signals should be preserved, not GC'd.
    top.setSuspended(true);
    await nextTick();

    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Wait well beyond the GC sweep interval.
    await sleep(50);

    // Signals should STILL be in the map — suspension keeps them alive.
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Changes while suspended should not trigger re-evaluation.
    source.value = 2;
    await nextTick();

    expect(evalCount).toBe(1);
    expect(getSignalsMap(getGlobalScope()).size).toBe(2);

    // Fully unwatch — now signals should be cleaned up.
    unwatchTop();
    await sleep(20);

    expect(evalCount).toBe(1);
    expect(getSignalsMap(getGlobalScope()).size).toBe(0);
  });
});
