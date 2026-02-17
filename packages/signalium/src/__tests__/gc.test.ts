import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal, Watcher } from '../index.js';
import { SignalScope, getGlobalScope, clearGlobalContexts } from '../internals/contexts.js';
import { nextTick, sleep } from './utils/async.js';

// Helper to access private properties for testing
const getSignalsCount = (scope: SignalScope = getGlobalScope()) => {
  const signals = (scope as any).signals as Map<number, WeakRef<any>>;

  return Array.from(signals.values()).filter(ref => ref.deref() !== undefined).length;
};

const runIsolatedAsync = async (fn: () => Promise<void>) => {
  await fn();

  // sleep to ensure that everything has been cleaned up
  await sleep(10);

  // force a GC
  global.gc();
};

describe('Garbage Collection', () => {
  beforeEach(() => {
    clearGlobalContexts();
  });

  it('should automatically garbage collect unwatched signals', async () => {
    const testSignal = reactive(() => 42);

    await runIsolatedAsync(async () => {
      const w = watcher(() => testSignal());

      // Watch the signal
      const unwatch = w.addListener(() => {
        testSignal();
      });

      await sleep(10);

      // force a GC to ensure that the signal is not garbage collected
      global.gc();

      // Signal should be in the scope
      expect(getSignalsCount()).toBe(1);

      // Unwatch the signal
      unwatch();
    });

    // Signal should be garbage collected
    expect(getSignalsCount()).toBe(0);
  });

  it('should not garbage collect signals that are still being watched', async () => {
    // Create a signal
    const watchedSignal = reactive(() => 'watched');

    const w = watcher(() => watchedSignal());

    await runIsolatedAsync(async () => {
      // Watch the signal but don't unwatch
      w.addListener(() => {
        watchedSignal();
      });

      await nextTick();

      // Signal should be in the scope
      expect(getSignalsCount()).toBe(1);

      await sleep(50);
    });

    // Signal should still be in the scope because it's being watched
    expect(getSignalsCount()).toBe(1);
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
    const contextScope = (getGlobalScope() as any).children.values().next().value;

    await sleep(50);

    // Signal should be garbage collected from the context scope
    expect(getSignalsCount(contextScope)).toBe(0);
  });

  it('propagates unwatching to dependencies and tears them down without GC', async () => {
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

    await runIsolatedAsync(async () => {
      const top = watcher(() => mid2());

      let unwatchTop = top.addListener(() => {});

      // Wait for initial activation.
      await nextTick();

      expect(evalCount).toBe(1);
      expect(getSignalsCount()).toBe(2);

      // Verify the counter works by changing source.
      source.value = 2;
      await nextTick();

      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Suspend the Watcher — function should not rerun.
      unwatchTop();
      await nextTick();

      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Change source while suspended — still no rerun.
      source.value = 3;
      await nextTick();

      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Reset source to 2 and resume. The _output_ of `mid1` is still
      // 2 + 1 = 3, unchanged. So `mid2` should NOT rerun if cached.
      //
      // If `mid2` had been GC'd, it would have to be recreated, and the
      // counter would increment.
      source.value = 2;
      unwatchTop = top.addListener(() => {});
      await nextTick();

      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Fully unwatch — counter should remain unchanged.
      unwatchTop();
    });

    expect(evalCount).toBe(2);
    expect(getSignalsCount()).toBe(0);
  });

  it('shared dependency stays active until all consumers are garbage collected', async () => {
    // Track how many times mid2 re-evaluates.
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    await runIsolatedAsync(async () => {
      // Two watchers share the same dependency chain.
      const topA = watcher(() => mid2());
      const topB = watcher(() => mid2());

      const unwatchA = topA.addListener(() => {});
      const unwatchB = topB.addListener(() => {});

      await nextTick();

      // Both watchers share mid2 — it evaluates once.
      expect(evalCount).toBe(1);
      expect(getSignalsCount()).toBe(2);

      // Suspend only A — mid2 stays active because B is still watching.
      unwatchA();
      source.value = 2;
      await nextTick();

      // mid2 re-evaluates because B is still active.
      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Suspend B — mid2 is now fully suspended.
      unwatchB();
      source.value = 3;
      await nextTick();

      // No re-evaluation while fully suspended.
      expect(evalCount).toBe(2);
      expect(getSignalsCount()).toBe(2);

      // Unwatch both — signals should be cleaned up.
      unwatchA();
      unwatchB();
    });

    expect(evalCount).toBe(2);
    expect(getSignalsCount()).toBe(0);
  });

  it('does not leak state across repeated watch-unwatch cycles', async () => {
    let evalCount = 0;

    const source = signal(1);
    const mid1 = reactive(() => source.value + 1);
    const mid2 = reactive(() => {
      evalCount++;
      return mid1() + 1;
    });

    for (let i = 0; i < 15; i++) {
      await runIsolatedAsync(async () => {
        // Watcher needs to be defined within the loop to
        // ensure that the signals will be garbage collected,
        // otherwise the closure holds onto them
        const top = watcher(() => mid2());

        let unwatchTop = top.addListener(() => {});
        await nextTick();

        expect(getSignalsCount()).toBe(2);

        // Suspend and unwatch.
        unwatchTop();
      });

      expect(getSignalsCount()).toBe(0);
    }

    // After many cycles, all signals should be properly cleaned up.
    await sleep(50);

    expect(getSignalsCount()).toBe(0);
  });
});
