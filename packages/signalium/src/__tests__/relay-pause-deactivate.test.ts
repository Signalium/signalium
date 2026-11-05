import { describe, expect, test } from 'vitest';
import { reactive, relay, watcher } from '../index.js';
import { watchSignal, unwatchSignal } from '../internals/watch.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { releaseRenderLeases } from '../internals/lease.js';
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

  const createRelay = () => {
    const deactivations: boolean[] = [];
    const sub = relay<number>(state => {
      state.value = 1;
      return {
        deactivate: ({ isPausing = false } = {}) => {
          deactivations.push(isPausing);
        },
      };
    });
    return { deactivations, sub };
  };

  const setup = () => {
    const { deactivations, sub } = createRelay();
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

  test('a relay shared by paused readers is cleaned up once the last is released', async () => {
    const { deactivations, sub } = createRelay();
    const readers = [watcher(() => sub.value), watcher(() => sub.value)];
    const unsubs = readers.map(r => r.addListener(() => {}));
    await nextTick();

    for (const r of readers) (r as unknown as ReactiveSignal<any, any>)._addPausedReaders(1);
    await nextTick();
    expect(deactivations).toEqual([true]);

    unsubs[0]();
    await nextTick();
    expect(deactivations).toEqual([true]);

    unsubs[1]();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
  });

  test('a paused render lease that expires gives its relays a cleanup', async () => {
    const { deactivations, sig } = setup();
    sig.addListenerLazy();
    void sig.value;
    await nextTick();

    // What PauseSignalsManager.setPaused(true) does to a render lease it tracks.
    sig._pauseWatch();
    await nextTick();
    expect(deactivations).toEqual([true]);

    releaseRenderLeases();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
  });

  test('a release reaches each signal of a diamond-shaped graph once', async () => {
    const { deactivations, sub } = createRelay();
    let layer = [reactive(() => sub.value ?? 0), reactive(() => sub.value ?? 0)];
    for (let i = 0; i < 16; i++) {
      const [left, right] = layer;
      layer = [reactive(() => left() + right()), reactive(() => left() + right())];
    }
    const [left, right] = layer;
    const w = watcher(() => left() + right());
    const sig = w as unknown as ReactiveSignal<any, any>;
    const unsub = w.addListener(() => {});
    await nextTick();

    sig._addPausedReaders(1);
    await nextTick();

    const relaySignal = (sub as unknown as { _signal: ReactiveSignal<any, any> })._signal;
    const { deps } = relaySignal;
    let visits = 0;
    Object.defineProperty(relaySignal, 'deps', {
      get: () => {
        visits++;
        return deps;
      },
    });

    unsub();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
    expect(visits).toBe(1);
  });
});
