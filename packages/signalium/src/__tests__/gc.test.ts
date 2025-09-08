import { describe, it, expect, beforeEach } from 'vitest';
import { reactive, context, withContexts, watcher, signal } from '../index.js';
import { SignalScope, GLOBAL_SCOPE, clearGlobalContexts } from '../internals/contexts.js';
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
    const unwatch = w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    // Signal should be in the scope
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);

    unwatch();
    await nextTick();

    // Signal should be in GC candidates
    expect(getGCCandidates(GLOBAL_SCOPE).size).toBe(2);

    // Watch again
    w.addListener(() => {});
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    w.value;

    await nextTick();

    // Signal should be removed from GC candidates
    expect(getSignalsMap(GLOBAL_SCOPE).size).toBe(1);
    expect(getGCCandidates(GLOBAL_SCOPE).size).toBe(0);
  });
});
