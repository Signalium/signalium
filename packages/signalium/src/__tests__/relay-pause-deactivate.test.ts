import { describe, expect, test } from 'vitest';
import { reactive, relay, watcher } from '../index.js';
import { watchSignal, unwatchSignal } from '../internals/watch.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { nextTick } from './utils/async.js';

describe('relay deactivate distinguishes pause from cleanup', () => {
  /**
   * A relay torn down because its watchers were temporarily paused (e.g.
   * PauseSignalsProvider toggling to `true`) must report `isPausing === true`
   * so consumers like fetchium can skip destructive work such as scheduling
   * garbage collection. A genuine cleanup reports `isPausing === false`.
   */
  test('pause passes isPausing=true; cleanup passes isPausing=false', async () => {
    const deactivations: boolean[] = [];

    const sub = relay<number>(state => {
      state.value = 1;
      return {
        deactivate: ({ isPausing = false } = {}) => {
          deactivations.push(isPausing);
        },
      };
    });

    const computed = reactive(() => sub.value);
    const w = watcher(() => computed());
    const sig = w as unknown as ReactiveSignal<any, any>;

    const unsub = w.addListener(() => {});
    await nextTick();
    expect(w.value).toBe(1);

    // Pause: unwatch with isPausing = true (PauseSignalsManager.setPaused(true)).
    unwatchSignal(sig, { isPausing: true });
    await nextTick();
    expect(deactivations).toEqual([true]);

    // Resume, then a genuine cleanup unwatch.
    watchSignal(sig);
    await nextTick();
    expect(w.value).toBe(1);

    unwatchSignal(sig);
    await nextTick();
    expect(deactivations).toEqual([true, false]);

    unsub();
  });

  const setup = () => {
    const deactivations: boolean[] = [];
    const sub = relay<number>(state => {
      state.value = 1;
      return {
        deactivate: ({ isPausing = false } = {}) => {
          deactivations.push(isPausing);
        },
      };
    });
    const computed = reactive(() => sub.value);
    const w = watcher(() => computed());
    return { deactivations, w, sig: w as unknown as ReactiveSignal<any, any> };
  };

  test('a reader released while paused gives its relays a cleanup', async () => {
    const { deactivations, w, sig } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();

    // What PauseSignalsManager.setPaused(true) does to its readers.
    sig._addPausedReaders(1);
    await nextTick();
    expect(deactivations).toEqual([true]);

    unsub();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
  });

  test('a paused reader that resubscribes in the same tick keeps its relays paused', async () => {
    const { deactivations, w, sig } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();

    sig._addPausedReaders(1);
    await nextTick();

    unsub();
    const unsubAgain = w.addListener(() => {});
    await nextTick();
    expect(deactivations).toEqual([true]);

    unsubAgain();
  });
});
