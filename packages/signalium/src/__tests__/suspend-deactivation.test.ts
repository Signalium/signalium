import { describe, expect, test } from 'vitest';
import { reactive, watcher } from '../index.js';
import { watchSignal, unwatchSignal } from '../internals/watch.js';
import { schedulePull } from '../internals/scheduling.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { nextTick, sleep } from './utils/async.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('unwatch then rewatch before deactivation fires', () => {
  /**
   * Exercises the path where:
   * 1. A watcher actively subscribes to a sync-wrapper-over-async signal
   * 2. The watcher is unwatched (schedules deactivation)
   * 3. The watcher is immediately rewatched (before deactivation fires)
   * 4. The async value resolves
   *
   * The rewatch via watchSignal must cancel the pending deactivation
   * so deps' watchCounts are not damaged when the flush runs.
   */
  test('signal resolves after unwatch → rewatch with pending deactivation', async () => {
    const deferred = createDeferred<string>();

    const getAsyncValue = reactive(async () => {
      return await deferred.promise;
    });

    const getWrappedValue = reactive(() => {
      const promise = getAsyncValue();
      return promise.isPending ? 'pending' : promise.value;
    });

    const w = watcher(() => getWrappedValue());

    let latestValue: unknown;
    const unsub = w.addListener(() => {
      latestValue = w.value;
    });
    await nextTick();
    expect(w.value).toBe('pending');

    // Step 2: unwatch (like PauseSignalsProvider changing to true)
    unwatchSignal(w as unknown as ReactiveSignal<any, any>);

    // Step 3: immediately rewatch (before deactivation fires)
    watchSignal(w as unknown as ReactiveSignal<any, any>);
    schedulePull(w as unknown as ReactiveSignal<any, any>);

    // Let the scheduled flush run — deactivation should have been cancelled
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
