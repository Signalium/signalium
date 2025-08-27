import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal } from '../index.js';
import { SignalScope, GLOBAL_SCOPE, forceGc, clearGlobalContexts } from '../internals/contexts.js';
import { nextTick, sleep } from './utils/async.js';

// Helper to access private properties for testing
const getSignalsMap = (scope: SignalScope) => {
  return (scope as any).signals as Map<number, any>;
};

const getGCCandidates = (scope: SignalScope) => {
  return (scope as any).gcCandidates as Set<any>;
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
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    // Unwatch the signal
    unwatch();

    await sleep(50);

    // Signal should be garbage collected
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(0);
  });

  it('should not garbage collect signals with shouldGC returning false', async () => {
    // Create a signal that should not be garbage collected
    const persistentSignal = reactive(() => 'persist', {
      shouldGC: () => false,
    });

    const w = watcher(() => persistentSignal());

    // Watch the signal
    const unwatch = w.addListener(() => {
      persistentSignal();
    });

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    // Unwatch the signal
    unwatch();

    await sleep(50);

    // Signal should still be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);
  });

  it('should support conditional GC based on signal state', async () => {
    // Create a signal with conditional GC
    const shouldAllowGC = signal(false);

    const conditionalSignal = reactive(() => shouldAllowGC.value, {
      shouldGC: (signal, value) => {
        // console.log('shouldGC', signal, value);
        return value;
      },
    });

    const w = watcher(() => conditionalSignal());

    // Watch the signal
    const unwatch = w.addListener(() => {
      conditionalSignal();
    });

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    // Unwatch the signal
    unwatch();

    await sleep(50);

    // Signal should still be in the scope because shouldGC returns false
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    // Now allow GC
    shouldAllowGC.value = true;

    // Watch the signal
    const unwatch2 = w.addListener(() => {
      conditionalSignal();
    });

    await nextTick();

    // Signal should be in GC candidates
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    unwatch2();

    await sleep(50);

    // Signal should be garbage collected
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(0);
  });

  it('should support manual garbage collection', async () => {
    let signalObj: object;

    // Create multiple signals
    const signal1 = reactive(() => 'signal1');
    const signal2 = reactive(() => 'signal2', {
      shouldGC: signal => {
        signalObj = signal;
        return false;
      },
    });

    const w1 = watcher(() => signal1());
    const w2 = watcher(() => signal2());

    // Watch both signals
    const unwatch1 = w1.addListener(() => {
      signal1();
    });
    const unwatch2 = w2.addListener(() => {
      signal2();
    });

    await nextTick();

    // Both signals should be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(2);

    // Unwatch both signals
    unwatch1();
    unwatch2();

    await sleep(50);

    // Only signal1 should be garbage collected
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    // The remaining signal should be signal2
    const remainingSignal = Array.from(getSignalsMap(GLOBAL_SCOPE).values())[0];
    expect(remainingSignal.value).toBe('signal2');

    forceGc(signalObj!);

    await sleep(50);

    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(0);
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
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    await sleep(50);

    // Signal should still be in the scope because it's being watched
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);
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
    const contextScope = (GLOBAL_SCOPE as any).children.values().next().value;

    await sleep(50);

    // Signal should be garbage collected from the context scope
    expect(getSignalsMap(contextScope).size).toBe(0);
  });

  it('should remove signal from GC candidates if watched again', async () => {
    // Create a signal
    const signal = reactive(() => 'rewatch');

    const w = watcher(() => signal());

    // Watch and unwatch
    const unwatch = w.addListener(() => {
      signal();
    });

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    unwatch();
    await nextTick();

    // Signal should be in GC candidates
    expect(getGCCandidates(GLOBAL_SCOPE).size).toBe(1);

    // Watch again
    w.addListener(() => {
      signal();
    });

    await nextTick();

    // Signal should be removed from GC candidates
    expect(getGCCandidates(GLOBAL_SCOPE).size).toBe(0);
  });
});
