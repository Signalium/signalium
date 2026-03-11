import { describe, expect, test } from 'vitest';
import { reactive, watcher } from '../index.js';
import { nextTick, sleep } from './utils/async.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('suspend then resume before deactivation fires', () => {
  /**
   * Exercises the path where:
   * 1. A watcher actively subscribes to a sync-wrapper-over-async signal
   * 2. The watcher is suspended (schedules deactivation)
   * 3. The watcher is immediately resumed (before deactivation fires)
   * 4. The async value resolves
   *
   * resumeSignal sees _isActive === true (deactivation hasn't run yet)
   * so it skips reactivation AND does not cancel the pending deactivation.
   * When the deactivation later fires, suspendCount is 0 so it takes the
   * hard-deactivation path and damages deps' watchCounts.
   */
  test('signal resolves after suspend → resume with pending deactivation', async () => {
    const deferred = createDeferred<string>();

    const getAsyncValue = reactive(async () => {
      return await deferred.promise;
    });

    const getWrappedValue = reactive(() => {
      const promise = getAsyncValue();
      return promise.isPending ? 'pending' : promise.value;
    });

    // Create a watcher that mimics a React component
    const w = watcher(() => getWrappedValue());

    // Step 1: actively subscribe
    let latestValue: unknown;
    const unsub = w.addListener(() => {
      latestValue = w.value;
    });
    await nextTick();
    expect(w.value).toBe('pending');

    // Step 2: suspend (like SuspendSignalsProvider changing to true)
    w.setSuspended(true);

    // Step 3: immediately resume (like a second component unsuspending)
    // This is BEFORE the scheduled deactivation fires.
    w.setSuspended(false);

    // Let the scheduled flush run — if deactivation isn't cancelled,
    // it will damage deps
    await nextTick();

    // Step 4: resolve the async value
    deferred.resolve('ready');

    // Wait for the async resolution to propagate
    await nextTick();
    await sleep(10);
    await nextTick();

    expect(w.value).toBe('ready');

    unsub();
  });
});
