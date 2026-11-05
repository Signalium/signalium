import { describe, expect, test } from 'vitest';
import { reactive, relay, signal, watcher } from '../index.js';
import { ReactiveSignal } from '../internals/reactive.js';
import { releaseRenderLeases } from '../internals/lease.js';
import { nextTick, sleep } from './utils/async.js';

describe('relay deactivate distinguishes pause from cleanup', () => {
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

  const asSignal = (reader: unknown) => reader as ReactiveSignal<any, any>;

  // What PauseSignalsManager.setPaused does to its readers.
  const pause = (...readers: unknown[]) => {
    for (const reader of readers) asSignal(reader)._addPausedReaders(1);
  };
  const resume = (reader: unknown) => asSignal(reader)._addPausedReaders(-1);

  /**
   * A relay torn down because its watchers were temporarily paused (e.g.
   * PauseSignalsProvider toggling to `true`) must report `isPausing === true`
   * so consumers like fetchium can skip destructive work such as scheduling
   * garbage collection. A genuine cleanup reports `isPausing === false`.
   */
  test('pause passes isPausing=true; cleanup passes isPausing=false', async () => {
    const { deactivations, w } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();
    expect(w.value).toBe(1);

    pause(w);
    await nextTick();
    expect(deactivations).toEqual([true]);

    resume(w);
    await nextTick();
    expect(w.value).toBe(1);

    unsub();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
  });

  test('a reader released while paused gives its relays a cleanup', async () => {
    const { deactivations, w } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();

    pause(w);
    await nextTick();
    expect(deactivations).toEqual([true]);

    unsub();
    await nextTick();
    expect(deactivations).toEqual([true, false]);
  });

  test('a reader paused and released in the same tick gets a single cleanup', async () => {
    const { deactivations, w } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();

    pause(w);
    unsub();
    await nextTick();
    expect(deactivations).toEqual([false]);
  });

  test('a paused reader that resubscribes in the same tick keeps its relays paused', async () => {
    const { deactivations, w } = setup();
    const unsub = w.addListener(() => {});
    await nextTick();

    pause(w);
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

    pause(...readers);
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

  test.each([
    ['directly', (r: ReturnType<typeof createRelay>['sub']) => () => r.value],
    ['through a reactive', (r: ReturnType<typeof createRelay>['sub']) => reactive(() => r.value)],
  ])('a paused reader that switches deps holds its new deps (%s)', async (_, read) => {
    const r1 = createRelay();
    const r2 = createRelay();
    const read1 = read(r1.sub);
    const read2 = read(r2.sub);
    const useFirst = signal(true);
    const a = watcher(() => (useFirst.value ? read1() : read2()));
    const b = watcher(() => read2());
    const unsubA = a.addListener(() => {});
    const unsubB = b.addListener(() => {});
    await nextTick();

    for (const r of [a, b]) (r as unknown as ReactiveSignal<any, any>)._addPausedReaders(1);
    await nextTick();
    expect([r1.deactivations, r2.deactivations]).toEqual([[true], [true]]);

    // A paused reader still recomputes when its parent rerenders.
    useFirst.value = false;
    void a.value;
    await nextTick();
    expect([r1.deactivations, r2.deactivations]).toEqual([[true, false], [true]]);

    unsubA();
    await nextTick();
    expect(r2.deactivations).toEqual([true]);

    unsubB();
    await nextTick();
    expect(r2.deactivations).toEqual([true, false]);
  });

  test('a dep a paused reader stops reading keeps no hold', async () => {
    const { deactivations, sub } = createRelay();
    const other = createRelay();
    const useRelay = signal(true);
    const a = watcher(() => (useRelay.value ? sub.value : other.sub.value));
    const unsubA = a.addListener(() => {});
    await nextTick();

    (a as unknown as ReactiveSignal<any, any>)._addPausedReaders(1);
    await nextTick();
    useRelay.value = false;
    void a.value;
    await nextTick();
    expect(deactivations).toEqual([true, false]);
    unsubA();
    await nextTick();

    const b = watcher(() => sub.value);
    const unsubB = b.addListener(() => {});
    await nextTick();
    (b as unknown as ReactiveSignal<any, any>)._addPausedReaders(1);
    await nextTick();
    unsubB();
    await nextTick();
    expect(deactivations).toEqual([true, false, true, false]);
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
    const unsub = w.addListener(() => {});
    await nextTick();

    pause(w);
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
  test('a relay whose active reader leaves while another reader is paused on it pauses until that reader is released', async () => {
    const r = createRelay();
    const a = watcher(() => r.sub.value);
    const b = watcher(() => r.sub.value);
    const unsubA = a.addListener(() => {});
    const unsubB = b.addListener(() => {});
    await nextTick();

    pause(a);
    await nextTick();
    expect(r.deactivations).toEqual([]);

    unsubB();
    await nextTick();
    expect(r.deactivations).toEqual([true]);

    unsubA();
    await nextTick();
    expect(r.deactivations).toEqual([true, false]);
  });

  describe('a paused reader that recomputes', () => {
    test('and stops reading a relay leaves an active reader watching it', async () => {
      const r = createRelay();
      const keep = signal(true);
      const a = watcher(() => (keep.value ? r.sub.value : 0));
      const b = watcher(() => r.sub.value);
      const unsubA = a.addListener(() => {});
      const unsubB = b.addListener(() => {});
      await nextTick();

      pause(a);
      await nextTick();

      keep.value = false;
      void a.value;
      await nextTick();
      expect(r.deactivations).toEqual([]);

      unsubB();
      await nextTick();
      expect(r.deactivations).toEqual([false]);

      unsubA();
    });

    test('and settles without a relay leaves it paused for another paused reader', async () => {
      const r = createRelay();
      const keep = signal(true);
      const inner = reactive(async () => {
        const value = keep.value ? r.sub.value : 0;
        await Promise.resolve();
        return value;
      });
      const a = watcher(() => inner().value);
      const b = watcher(() => r.sub.value);
      const unsubA = a.addListener(() => {});
      const unsubB = b.addListener(() => {});
      await sleep();

      pause(a, b);
      await nextTick();
      expect(r.deactivations).toEqual([true]);

      keep.value = false;
      void a.value;
      await sleep();
      expect(r.deactivations).toEqual([true]);

      unsubA();
      unsubB();
      await nextTick();
      expect(r.deactivations).toEqual([true, false]);
    });

    test('and starts reading a relay another paused reader holds keeps it held across a resume and re-pause', async () => {
      const r1 = createRelay();
      const r2 = createRelay();
      const both = signal(false);
      const a = watcher(() => (both.value ? r1.sub.value + r2.sub.value : r1.sub.value));
      const b = watcher(() => r2.sub.value);
      const unsubA = a.addListener(() => {});
      const unsubB = b.addListener(() => {});
      await nextTick();

      pause(a, b);
      await nextTick();

      both.value = true;
      void a.value;
      await nextTick();

      resume(a);
      await nextTick();
      pause(a);
      await nextTick();
      expect(r2.deactivations).toEqual([true, true]);

      unsubA();
      await nextTick();
      expect(r2.deactivations).toEqual([true, true]);

      unsubB();
      await nextTick();
      expect(r2.deactivations).toEqual([true, true, false]);
    });
  });

  test('a reader recomputed after its last listener leaves keeps the watches of the relays it starts reading', async () => {
    const r1 = createRelay();
    const r2 = createRelay();
    const useR2 = signal(false);
    const a = watcher(() => (useR2.value ? r2.sub.value : r1.sub.value));
    const b = watcher(() => r2.sub.value);
    const unsubA = a.addListener(() => {});
    const unsubB = b.addListener(() => {});
    await nextTick();

    unsubA();
    useR2.value = true;
    void a.value;
    await nextTick();
    expect(r2.deactivations).toEqual([]);

    unsubB();
    await nextTick();
    expect(r2.deactivations).toEqual([false]);
  });
});
