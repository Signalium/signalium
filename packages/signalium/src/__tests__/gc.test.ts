import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal } from '../index.js';
import { SignalScope, getGlobalScope, clearGlobalContexts } from '../internals/contexts.js';
import { nextTick, sleep } from './utils/async.js';
import { suspendSignalWatch, resumeSignalWatch } from '../internals/watch.js';

// Helper to access private properties for testing
const getSignalsMap = (scope: SignalScope) => {
  return (scope as any).signals as Map<number, any>;
};

const getGCCandidates = (scope: SignalScope) => {
  return (scope as any).gcCandidates as Set<any>;
};

type TestReactiveSignal = {
  deps: Map<any, any>;
  watchCount: number;
  suspendCount: number;
  isFullySuspended: boolean;
  pendingUnwatchCount: number;
};

const asTestSignal = (value: unknown): TestReactiveSignal => {
  return value as TestReactiveSignal;
};

const getContextChildScope = (scope: SignalScope): SignalScope => {
  return (scope as any).children.values().next().value as SignalScope;
};

const getFirstDependencySignal = (signal: TestReactiveSignal): TestReactiveSignal => {
  return Array.from(signal.deps.keys())[0] as TestReactiveSignal;
};

const getWatchCount = (signal: TestReactiveSignal): number => signal.watchCount;
const getSuspendCount = (signal: TestReactiveSignal): number => signal.suspendCount;
const getIsFullySuspended = (signal: TestReactiveSignal): boolean => signal.isFullySuspended;
const getPendingUnwatchCount = (signal: TestReactiveSignal): number => signal.pendingUnwatchCount;

const suspendTestSignal = (signal: TestReactiveSignal): void => {
  suspendSignalWatch(signal as any);
};

const resumeTestSignal = (signal: TestReactiveSignal): void => {
  resumeSignalWatch(signal as any);
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
    const source = signal(1);
    const mid = reactive(() => source.value + 1);
    const top = watcher(() => mid());

    const stop = top.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
    });

    // Establish dependency graph top -> mid
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    top.value;
    await nextTick();

    const topSignal = asTestSignal(top);
    const midSignal = getFirstDependencySignal(topSignal);
    expect(getWatchCount(midSignal)).toBeGreaterThan(0);

    suspendTestSignal(topSignal);
    stop();
    await nextTick();

    // Top is unwatched and fully suspended; dependency teardown happens eagerly.
    expect(getWatchCount(topSignal)).toBe(0);
    expect(getIsFullySuspended(topSignal)).toBe(true);
    expect(getPendingUnwatchCount(topSignal)).toBeGreaterThan(0);
    expect(getWatchCount(midSignal)).toBe(0);

    resumeTestSignal(topSignal);
    await sleep(20);

    expect(getIsFullySuspended(topSignal)).toBe(false);
    expect(getPendingUnwatchCount(topSignal)).toBe(0);
    expect(getWatchCount(midSignal)).toBe(0);
  });

  it('requires full suspend count release before suspension clears', async () => {
    const source = signal(1);
    const mid = reactive(() => source.value + 1);
    const top = watcher(() => mid());

    const stop = top.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    top.value;
    await nextTick();

    const topSignal = asTestSignal(top);
    const midSignal = getFirstDependencySignal(topSignal);

    suspendTestSignal(topSignal);
    suspendTestSignal(topSignal);
    await nextTick();

    expect(getSuspendCount(topSignal)).toBe(2);
    expect(getPendingUnwatchCount(topSignal)).toBe(0);
    expect(getWatchCount(midSignal)).toBe(0);

    // First resume should not clear suspension state yet.
    resumeTestSignal(topSignal);
    await nextTick();
    expect(getSuspendCount(topSignal)).toBe(1);
    expect(getPendingUnwatchCount(topSignal)).toBe(0);
    expect(getWatchCount(midSignal)).toBe(0);

    // Final resume clears suspension state.
    resumeTestSignal(topSignal);
    await sleep(20);

    expect(getSuspendCount(topSignal)).toBe(0);
    expect(getPendingUnwatchCount(topSignal)).toBe(0);
    expect(getWatchCount(midSignal)).toBeGreaterThan(0);

    stop();
  });

  it('cancels deferred unwatch when rewatched before resume', async () => {
    const source = signal(1);
    const mid = reactive(() => source.value + 1);
    const top = watcher(() => mid());

    const stop = top.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    top.value;
    await nextTick();

    const topSignal = asTestSignal(top);
    const midSignal = getFirstDependencySignal(topSignal);

    suspendTestSignal(topSignal);
    stop();
    await nextTick();

    expect(getPendingUnwatchCount(topSignal)).toBeGreaterThan(0);

    const rewatchStop = top.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    top.value;
    await nextTick();

    expect(getWatchCount(topSignal)).toBeGreaterThan(0);
    expect(getPendingUnwatchCount(topSignal)).toBe(0);

    // Resuming now should not tear down because it is actively watched again.
    resumeTestSignal(topSignal);
    await nextTick();
    expect(getWatchCount(midSignal)).toBeGreaterThan(0);

    rewatchStop();
  });

  it('does not leak suspend/deferred counters across repeated suspend-resume cycles', async () => {
    const source = signal(1);
    const mid = reactive(() => source.value + 1);
    const top = watcher(() => mid());
    const globalScope = getGlobalScope();
    const topSignal = asTestSignal(top);

    for (let i = 0; i < 15; i++) {
      const stop = top.addListener(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        top.value;
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
      await nextTick();

      suspendTestSignal(topSignal);
      stop();
      await nextTick();

      resumeTestSignal(topSignal);
      await sleep(5);

      expect(getSuspendCount(topSignal)).toBe(0);
      expect(getIsFullySuspended(topSignal)).toBe(false);
      expect(getPendingUnwatchCount(topSignal)).toBe(0);
      expect(getWatchCount(topSignal)).toBe(0);
    }

    // Allow GC sweep to run and ensure we didn't accumulate retained graph state.
    await sleep(50);

    expect(getGCCandidates(globalScope).size).toBe(0);
    expect(getSignalsMap(globalScope).size).toBe(0);
  });

  it('accumulates suspend counts on shared dependencies from multiple suspended consumers', async () => {
    const source = signal(1);
    const shared = reactive(() => source.value + 1);
    const topA = watcher(() => shared());
    const topB = watcher(() => shared());

    const stopA = topA.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      topA.value;
    });
    const stopB = topB.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      topB.value;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    topA.value;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    topB.value;
    await nextTick();

    const topSignalA = asTestSignal(topA);
    const topSignalB = asTestSignal(topB);
    const sharedSignal = getFirstDependencySignal(topSignalA);

    suspendTestSignal(topSignalA);
    stopA();
    await nextTick();
    expect(getSuspendCount(sharedSignal)).toBe(1);
    expect(getWatchCount(sharedSignal)).toBeGreaterThan(0);

    suspendTestSignal(topSignalB);
    stopB();
    await nextTick();
    expect(getSuspendCount(sharedSignal)).toBe(2);
    expect(getWatchCount(sharedSignal)).toBe(0);

    resumeTestSignal(topSignalA);
    await nextTick();
    expect(getSuspendCount(sharedSignal)).toBe(1);

    resumeTestSignal(topSignalB);
    await sleep(20);
    expect(getSuspendCount(sharedSignal)).toBe(0);
    expect(getWatchCount(sharedSignal)).toBe(0);
  });

  it('does not mark suspended signals for GC before resume', async () => {
    const source = signal(1);
    const mid = reactive(() => source.value + 1);
    const top = watcher(() => mid());

    const stop = top.addListener(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      top.value;
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    top.value;
    await nextTick();

    const topSignal = asTestSignal(top);
    const globalScope = getGlobalScope();

    suspendTestSignal(topSignal);
    stop();
    await nextTick();

    expect(getIsFullySuspended(topSignal)).toBe(true);
    expect(getGCCandidates(globalScope).size).toBe(0);
  });
});
