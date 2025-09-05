import { describe, expect, test } from 'vitest';
import { signal, ReactivePromise, Signal } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

describe('Promise', () => {
  const createLoader = <T>(state: Signal<T>, delay = 5) =>
    reactive(async () => {
      const v = state.value;
      await sleep(delay);
      return v;
    });

  describe('constructor', () => {
    test('supports executor resolve/reject like Promise constructor', async () => {
      const rp = new ReactivePromise<number>((resolve: (v: number | PromiseLike<number>) => void) => {
        setTimeout(() => resolve(7), 1);
      });

      const waiter = reactive(async () => {
        return (await rp) * 2;
      });

      const r = waiter();
      expect(r.isPending).toBe(true);
      await sleep(5);
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe(14);

      const err = new ReactivePromise(
        (_resolve: (v: never | PromiseLike<never>) => void, reject: (r: unknown) => void) => reject('x'),
      ) as unknown as Promise<never>;
      const waiterErr = reactive(async () => {
        try {
          await err;
          return 'ok';
        } catch (e) {
          return String(e);
        }
      });
      const rErr = waiterErr();
      await nextTick();
      expect(rErr.isResolved).toBe(true);
      expect(rErr.value).toBe('x');
    });
  });

  describe('Promise.all', () => {
    test('resolve produces a resolved Promise', async () => {
      const rp = ReactivePromise.resolve(42);
      expect(rp.isResolved).toBe(true);
      expect(rp.isReady).toBe(true);
      expect(rp.value).toBe(42);
      await nextTick();
      expect(await rp).toBe(42);
    });
  });

  describe('Promise.reject', () => {
    test('reject produces a rejected Promise', async () => {
      const err = new Error('boom');
      const rp = ReactivePromise.reject(err) as unknown as ReactivePromise<never>;
      expect(rp.isRejected).toBe(true);
      expect(rp.error).toBe(err);
      await expect(Promise.resolve(rp)).rejects.toBe(err);
    });
  });

  describe('Promise.withResolvers', () => {
    test('withResolvers resolves and rejects correctly (value and promise)', async () => {
      const { promise, resolve, reject } = ReactivePromise.withResolvers<number>();
      expect(promise.isPending).toBe(true);
      resolve(1);
      await nextTick();
      expect(promise.isResolved).toBe(true);
      expect(promise.value).toBe(1);

      const { promise: promise2, resolve: resolve2 } = ReactivePromise.withResolvers<number>();
      resolve2(Promise.resolve(2));
      expect(promise2.isPending).toBe(true);
      await nextTick();
      expect(promise2.isResolved).toBe(true);
      expect(promise2.value).toBe(2);

      const { promise: promise3, reject: reject3 } = ReactivePromise.withResolvers<number>();
      reject3('err');
      await nextTick();
      expect(promise3.isRejected).toBe(true);
      expect(promise3.error).toBe('err');
    });

    test('withResolvers promise awaited inside reactive function updates on resolve', async () => {
      const { promise, resolve } = ReactivePromise.withResolvers<number>();

      const waiter = reactive(async () => {
        const v = await promise;
        return v + 1;
      });

      const r = waiter();
      expect(r.isPending).toBe(true);

      resolve(41);
      await nextTick();
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe(42);
    });

    test('withResolvers chaining: two deferreds awaited sequentially', async () => {
      const a = ReactivePromise.withResolvers<number>();
      const b = ReactivePromise.withResolvers<number>();

      const chained = reactive(async () => {
        const v1 = await a.promise;
        const v2 = await b.promise;
        return v1 + v2;
      });

      const r = chained();
      expect(r.isPending).toBe(true);

      // Resolve second first; still pending due to awaiting a first
      b.resolve(2);
      await nextTick();
      expect(r.isPending).toBe(true);

      // Resolve first; computation should complete (b already resolved)
      a.resolve(3);
      await nextTick();
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe(5);

      // Reuse original promises without awaiting; should resolve immediately since both are settled
      const chained2 = reactive(() => {
        return Promise.all([a.promise, b.promise]);
      });
      const r2 = chained2();
      expect(r2.isResolved).toBe(true);
      const arr = r2.value as number[];
      expect(arr[0]).toBe(3);
      expect(arr[1]).toBe(2);
    });

    test('promises stored in signals can be replaced and combined correctly', async () => {
      const pA1 = Promise.withResolvers<number>();
      const pB1 = Promise.withResolvers<number>();
      const sigA = signal(pA1.promise as unknown as Promise<number>);
      const sigB = signal(pB1.promise as unknown as Promise<number>);

      const combined = reactive(async () => {
        const p1 = sigA.value;
        const p2 = sigB.value;
        const [v1, v2] = await Promise.all([p1, p2]);
        return v1 + v2;
      });

      const r1 = combined();
      expect(r1.isPending).toBe(true);
      pA1.resolve(5);
      await nextTick();
      expect(r1.isPending).toBe(true);
      pB1.resolve(7);
      await nextTick();
      expect(r1.isResolved).toBe(true);
      expect(r1.value).toBe(12);

      // Replace promises inside signals and resolve in opposite order
      const pA2 = Promise.withResolvers<number>();
      const pB2 = Promise.withResolvers<number>();
      sigA.value = pA2.promise as unknown as Promise<number>;
      sigB.value = pB2.promise as unknown as Promise<number>;

      const r2 = combined();
      expect(r2.isPending).toBe(true);
      pB2.resolve(20);
      await nextTick();
      expect(r2.isPending).toBe(true);
      pA2.resolve(10);
      await nextTick();
      expect(r2.isResolved).toBe(true);
      expect(r2.value).toBe(30);
    });
  });

  describe('Promise.all', () => {
    test('all waits for all and preserves order; propagates pending', async () => {
      const a = signal(1);
      const b = signal(2);
      const loadA = createLoader(a, 10);
      const loadB = createLoader(b, 5);

      const combined = reactive(async () => {
        const [av, bv] = await Promise.all([loadA(), loadB()]);
        return av + bv;
      });

      combined.watch();

      const result = combined();
      expect(result.isPending).toBe(true);
      await sleep(6);
      // B may have resolved but all should still be pending until A resolves
      expect(result.isPending).toBe(true);
      await sleep(10);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(3);

      // Change one dependency mid-flight; ensure old is dropped and final is latest
      a.value = 3;
      await nextTick();
      const result2 = combined();
      expect(result2.isPending).toBe(true);
      a.value = 4; // update again before previous finishes
      const result3 = combined();
      await sleep(25);
      expect(result3.isResolved).toBe(true);
      expect(result3.value).toBe(4 + 2);
    });

    test('all instance remains stable while inputs restart repeatedly (no await)', async () => {
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(
        async () => {
          const v = sa.value;
          await sleep(15);
          return v;
        },
        { desc: 'loadA' },
      );
      const loadB = reactive(
        async () => {
          const v = sb.value;
          await sleep(15);
          return v;
        },
        { desc: 'loadB' },
      );

      const agg = reactive(() => {
        return Promise.all([loadA(), loadB()]);
      });

      agg.watch();

      const outer = agg();
      expect(outer.isPending).toBe(true);
      expect(agg).toHaveCounts({ compute: 1 });

      // Restart A a few times before it can settle
      sa.value = 1;
      await sleep(5);
      sa.value = 2;
      await sleep(5);
      sa.value = 3;

      expect(outer.isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // Restart B as well
      sb.value = 4;
      await sleep(5);
      sb.value = 5;

      // Outer should be the same instance throughout
      // Cached compute should not rerun for identical inputs
      expect(agg).toHaveCounts({ compute: 1 });
      expect(agg().isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // Restart A a few times again
      sa.value = 4;
      await sleep(5);
      sa.value = 5;
      await sleep(5);
      sa.value = 6;

      // Outer should be the same instance throughout
      expect(agg()).toBe(outer);
      // Cached compute should not rerun for identical inputs
      expect(agg).toHaveCounts({ compute: 1 });
      expect(agg().isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // After enough time, both should settle with latest values
      await sleep(60);

      expect(outer.value).toEqual([6, 5]);

      // No additional recomputes happened implicitly
      expect(agg).toHaveCounts({ compute: 1 });
    });

    test('outer async await restarts if inner async await restarts after timeout', async () => {
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(
        async () => {
          const v = sa.value;
          await sleep(5);
          return v;
        },
        { desc: 'loadA' },
      );
      const loadB = reactive(
        async () => {
          const v = sb.value;
          await sleep(45);
          return v;
        },
        { desc: 'loadB' },
      );

      const agg = reactive(async () => {
        return await Promise.all([loadA(), loadB()]);
      });

      agg.watch();

      const outer = agg();
      expect(outer.isPending).toBe(true);
      expect(agg).toHaveCounts({ compute: 1 });

      // Restart A a few times before it can settle
      sa.value = 1;
      await sleep(1);
      sa.value = 2;
      await sleep(1);
      sa.value = 3;

      // wait for A to settle completely
      await sleep(10);

      sa.value = 4;
      await sleep(1);
      sa.value = 5;
      await sleep(1);
      sa.value = 6;

      // make sure it's still pending
      expect(agg().isPending).toBe(true);
      expect(agg().value).toEqual(undefined);

      // After enough time, both should settle with latest values
      await sleep(60);

      expect(agg().value).toEqual([6, 0]);

      // Additional recompute happened because the promise needed to restart and
      // recreate the Promise.all internally
      expect(agg).toHaveCounts({ compute: 2 });
    });

    test('awaiting all waits until fully settled through restarts (single compute)', async () => {
      let outerCompute = 0;
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(async () => {
        const v = sa.value;
        await sleep(10);
        return v;
      });
      const loadB = reactive(async () => {
        const v = sb.value;
        await sleep(10);
        return v;
      });

      const combined = reactive(async () => {
        outerCompute++;
        const [a, b] = await Promise.all([loadA(), loadB()]);
        return a + b;
      });

      const r = combined();
      expect(r.isPending).toBe(true);
      expect(outerCompute).toBe(1);

      // Restart A and B while pending
      sa.value = 1;
      await sleep(3);
      sa.value = 2;
      sb.value = 3;
      await sleep(3);
      sb.value = 4;

      // Still pending and compute hasn't rerun
      expect(r.isPending).toBe(true);
      expect(outerCompute).toBe(1);

      // Let everything settle
      await sleep(60);
      expect(r.isResolved).toBe(true);
      // Compute only ran once for the awaiting function
      expect(outerCompute).toBe(1);
    });

    test('all resolves immediately for empty array', async () => {
      const emptyAll = reactive(async () => {
        return await Promise.all([] as const);
      });

      const r = emptyAll();
      // Should resolve synchronously to []
      await nextTick();
      expect(r.isResolved).toBe(true);
      expect(r.value).toEqual([]);
    });

    test('all handles non-promises and thenables; preserves order', async () => {
      const thenable = (v: number, delay = 5): PromiseLike<number> => ({
        then<TResult1 = number, TResult2 = never>(
          onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          const p = new Promise<number>(resolve => setTimeout(() => resolve(v), delay));
          return p.then(onfulfilled as any, onrejected as any) as any;
        },
      });

      const combined = reactive(async () => {
        const arr = await Promise.all([1, thenable(2, 5), 3]);
        return arr.join(',');
      });

      const r = combined();
      expect(r.isPending).toBe(true);
      await sleep(10);
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe('1,2,3');
    });

    test('all rejects on first rejection and ignores later settlements', async () => {
      const goodSlow = reactive(async () => {
        await sleep(10);
        return 'ok';
      });
      const badFast = reactive(async () => {
        await sleep(1);
        throw new Error('boom');
      });
      const goodLater = reactive(async () => {
        await sleep(15);
        return 'later';
      });

      const all = reactive(async () => {
        return await Promise.all([goodSlow(), badFast(), goodLater()]);
      });

      const r = all();
      await sleep(3);
      expect(r.isRejected).toBe(true);
      expect((r.error as Error).message).toBe('boom');
      // Wait longer to ensure later fulfillments do not change the outcome
      await sleep(20);
      expect(r.isRejected).toBe(true);
      expect((r.error as Error).message).toBe('boom');
    });
  });

  describe('Promise.race', () => {
    test('race settles with the first to settle (resolve and reject cases)', async () => {
      const s1 = signal(1);
      const s2 = signal(2);
      const fast = createLoader(s1, 1);
      const slow = createLoader(s2, 20);

      const raced = reactive(async () => {
        return await Promise.race([slow(), fast()]);
      });

      const result = raced();
      await sleep(5);
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(1);

      // Reject-first scenario
      const rejecting = reactive(async () => {
        await sleep(1);
        throw new Error('nope');
      });
      const ok = reactive(async () => {
        await sleep(5);
        return 10;
      });
      const raced2 = reactive(async () => {
        return await Promise.race([rejecting(), ok()]);
      });
      const r2 = raced2();
      await sleep(3);
      expect(r2.isRejected).toBe(true);
      expect((r2.error as Error).message).toBe('nope');
    });
  });

  describe('Promise.any', () => {
    test('any resolves on first fulfillment; aggregates when all reject', async () => {
      const okLater = reactive(async () => {
        await sleep(5);
        return 'ok';
      });
      const badFast = reactive(async () => {
        await sleep(1);
        throw new Error('bad');
      });
      const any1 = reactive(async () => {
        return await Promise.any([badFast(), okLater()]);
      });
      const r1 = any1();
      await sleep(6);
      expect(r1.isResolved).toBe(true);
      expect(r1.value).toBe('ok');

      const bad1 = reactive(async () => {
        await sleep(1);
        throw 'a';
      });
      const bad2 = reactive(async () => {
        await sleep(2);
        throw 'b';
      });
      const any2 = reactive(async () => {
        return await Promise.any([bad1(), bad2()]);
      });
      const r2 = any2();
      await sleep(5);
      expect(r2.isRejected).toBe(true);
      expect(r2.error).toBeInstanceOf(AggregateError);
    });

    test('any rejects immediately for empty array (AggregateError)', async () => {
      const anyEmpty = reactive(async () => {
        return await Promise.any([] as const);
      });
      const r = anyEmpty();
      await nextTick();
      expect(r.isRejected).toBe(true);
      const err = r.error as AggregateError;
      expect(err).toBeInstanceOf(AggregateError);
      // Errors list should be empty and message should match implementation
      expect((err as any).errors?.length ?? 0).toBe(0);
      expect(err.message).toContain('No promises were provided to ReactivePromise.any');
    });

    test('any resolves immediately with first non-thenable value', async () => {
      const anyImmediate = reactive(async () => {
        return await Promise.any([42, reactive(async () => 7)()]);
      });
      const r = anyImmediate();
      await nextTick();
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe(42);
    });

    test('any aggregates errors by input order when all reject', async () => {
      const slowReject = reactive(async () => {
        await sleep(10);
        throw 'first';
      });
      const fastReject = reactive(async () => {
        await sleep(1);
        throw 'second';
      });
      const allBad = reactive(async () => {
        return await Promise.any([slowReject(), fastReject()]);
      });
      const r = allBad();
      await sleep(20);
      expect(r.isRejected).toBe(true);
      const err = r.error as AggregateError & { errors?: unknown[] };
      expect(err).toBeInstanceOf(AggregateError);
      // Should reflect input order: [slowReject, fastReject]
      expect(err.errors).toEqual(['first', 'second']);
    });

    test('any with mixed immediate, thenable, and promise values chooses first fulfillment', async () => {
      const thenable = (v: string, delay = 5): PromiseLike<string> => ({
        then<TResult1 = string, TResult2 = never>(
          onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          const p = new Promise<string>(resolve => setTimeout(() => resolve(v), delay));
          return p.then(onfulfilled as any, onrejected as any) as any;
        },
      });
      const anyMixed = reactive(async () => {
        return await Promise.any([
          reactive(async () => {
            await sleep(2);
            throw new Error('no');
          })(),
          thenable('yes', 1),
          'later',
        ]);
      });
      const r = anyMixed();
      await sleep(3);
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe('later');
    });
  });

  describe('Promise.allSettled', () => {
    test('allSettled reports results in order and does not reject', async () => {
      const good = reactive(async () => {
        await sleep(2);
        return 1;
      });
      const bad = reactive(async () => {
        await sleep(1);
        throw 'err';
      });
      const settled = reactive(async () => {
        return await Promise.allSettled([good(), bad()]);
      });
      const r = settled();
      await sleep(5);
      expect(r.isResolved).toBe(true);
      const arr = r.value! as PromiseSettledResult<any>[];
      expect(arr.length).toBe(2);
      expect(arr[0].status).toBe('fulfilled');
      expect((arr[0] as PromiseFulfilledResult<number>).value).toBe(1);
      expect(arr[1].status).toBe('rejected');
      expect((arr[1] as PromiseRejectedResult).reason).toBe('err');
    });

    test('allSettled waits for all and preserves order; propagates pending', async () => {
      const a = signal(1);
      const b = signal(2);
      const loadA = createLoader(a, 10);
      const loadB = createLoader(b, 5);

      const combined = reactive(async () => {
        const [ra, rb] = await Promise.allSettled([loadA(), loadB()]);
        return [ra, rb] as const;
      });

      combined.watch();

      const result = combined();
      expect(result.isPending).toBe(true);
      await sleep(6);
      // B may have resolved but allSettled should still be pending until A resolves
      expect(result.isPending).toBe(true);
      await sleep(10);
      expect(result.isResolved).toBe(true);
      const [ra, rb] = result.value! as readonly [PromiseSettledResult<number>, PromiseSettledResult<number>];
      expect(ra.status).toBe('fulfilled');
      expect((ra as PromiseFulfilledResult<number>).value).toBe(1);
      expect(rb.status).toBe('fulfilled');
      expect((rb as PromiseFulfilledResult<number>).value).toBe(2);

      // Change one dependency mid-flight; ensure old is dropped and final is latest
      a.value = 3;
      await nextTick();
      const result2 = combined();
      expect(result2.isPending).toBe(true);
      a.value = 4; // update again before previous finishes
      const result3 = combined();
      await sleep(25);
      expect(result3.isResolved).toBe(true);
      const [ra2, rb2] = result3.value! as readonly [PromiseSettledResult<number>, PromiseSettledResult<number>];
      expect(ra2.status).toBe('fulfilled');
      expect((ra2 as PromiseFulfilledResult<number>).value).toBe(4);
      expect(rb2.status).toBe('fulfilled');
      expect((rb2 as PromiseFulfilledResult<number>).value).toBe(2);
    });

    test('allSettled instance remains stable while inputs restart repeatedly (no await)', async () => {
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(
        async () => {
          const v = sa.value;
          await sleep(15);
          return v;
        },
        { desc: 'loadA' },
      );
      const loadB = reactive(
        async () => {
          const v = sb.value;
          await sleep(15);
          return v;
        },
        { desc: 'loadB' },
      );

      const agg = reactive(() => {
        return Promise.allSettled([loadA(), loadB()]);
      });

      agg.watch();

      const outer = agg();
      expect(outer.isPending).toBe(true);
      expect(agg).toHaveCounts({ compute: 1 });

      // Restart A a few times before it can settle
      sa.value = 1;
      await sleep(5);
      sa.value = 2;
      await sleep(5);
      sa.value = 3;

      expect(outer.isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // Restart B as well
      sb.value = 4;
      await sleep(5);
      sb.value = 5;

      // Outer should be the same instance throughout
      // Cached compute should not rerun for identical inputs
      expect(agg).toHaveCounts({ compute: 1 });
      expect(agg().isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // Restart A a few times again
      sa.value = 4;
      await sleep(5);
      sa.value = 5;
      await sleep(5);
      sa.value = 6;

      // Outer should be the same instance throughout
      expect(agg()).toBe(outer);
      // Cached compute should not rerun for identical inputs
      expect(agg).toHaveCounts({ compute: 1 });
      expect(agg().isPending).toBe(true);
      expect(outer.value).toEqual(undefined);

      // After enough time, both should settle with latest values
      await sleep(60);

      const settled = outer.value! as PromiseSettledResult<number>[];
      expect(settled[0].status).toBe('fulfilled');
      expect((settled[0] as PromiseFulfilledResult<number>).value).toBe(6);
      expect(settled[1].status).toBe('fulfilled');
      expect((settled[1] as PromiseFulfilledResult<number>).value).toBe(5);

      // No additional recomputes happened implicitly
      expect(agg).toHaveCounts({ compute: 1 });
    });

    test('outer async await restarts if inner async await restarts after timeout (allSettled)', async () => {
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(
        async () => {
          const v = sa.value;
          await sleep(5);
          return v;
        },
        { desc: 'loadA' },
      );
      const loadB = reactive(
        async () => {
          const v = sb.value;
          await sleep(60);
          return v;
        },
        { desc: 'loadB' },
      );

      const agg = reactive(async () => {
        return await Promise.allSettled([loadA(), loadB()]);
      });

      agg.watch();

      const outer = agg();
      expect(outer.isPending).toBe(true);
      expect(agg).toHaveCounts({ compute: 1 });

      // Restart A a few times before it can settle
      sa.value = 1;
      await sleep(1);
      sa.value = 2;
      await sleep(1);
      sa.value = 3;

      // wait for A to settle completely
      await sleep(10);

      sa.value = 4;
      await sleep(1);
      sa.value = 5;
      await sleep(1);
      sa.value = 6;

      // make sure it's still pending
      expect(agg().isPending).toBe(true);
      expect(agg().value).toEqual(undefined);

      // After enough time, both should settle with latest values
      await sleep(120);

      const final = agg().value! as PromiseSettledResult<number>[];
      expect(final[0].status).toBe('fulfilled');
      expect((final[0] as PromiseFulfilledResult<number>).value).toBe(6);
      expect(final[1].status).toBe('fulfilled');
      expect((final[1] as PromiseFulfilledResult<number>).value).toBe(0);

      // Additional recompute happened because the promise needed to restart and
      // recreate the Promise.allSettled internally
      expect(agg).toHaveCounts({ compute: 2 });
    });

    test('awaiting allSettled waits until fully settled through restarts (single compute)', async () => {
      let outerCompute = 0;
      const sa = signal(0);
      const sb = signal(0);

      const loadA = reactive(async () => {
        const v = sa.value;
        await sleep(10);
        return v;
      });
      const loadB = reactive(async () => {
        const v = sb.value;
        await sleep(10);
        return v;
      });

      const combined = reactive(async () => {
        outerCompute++;
        const [ra, rb] = await Promise.allSettled([loadA(), loadB()]);
        const a = ra.status === 'fulfilled' ? ra.value : 0;
        const b = rb.status === 'fulfilled' ? rb.value : 0;
        return a + b;
      });

      const r = combined();
      expect(r.isPending).toBe(true);
      expect(outerCompute).toBe(1);

      // Restart A and B while pending
      sa.value = 1;
      await sleep(3);
      sa.value = 2;
      sb.value = 3;
      await sleep(3);
      sb.value = 4;

      // Still pending and compute hasn't rerun
      expect(r.isPending).toBe(true);
      expect(outerCompute).toBe(1);

      // Let everything settle
      await sleep(60);
      expect(r.isResolved).toBe(true);
      // Compute only ran once for the awaiting function
      expect(outerCompute).toBe(1);
    });
  });

  describe('Composition', () => {
    test('chaining: results can be used to trigger subsequent Promise ops', async () => {
      const a = signal(1);
      const b = signal(2);
      const loadA = createLoader(a, 3);
      const loadB = createLoader(b, 3);

      const chained = reactive(async () => {
        const [av, bv] = await Promise.all([loadA(), loadB()]);
        const sum = av + bv;
        return await Promise.race([
          reactive(async () => {
            await sleep(1);
            return sum + 1;
          })(),
          reactive(async () => {
            await sleep(10);
            return -1;
          })(),
        ]);
      });

      const r = chained();
      await sleep(10);
      expect(r.isResolved).toBe(true);
      expect(r.value).toBe(1 + 2 + 1);

      // Dirty during pending chain
      a.value = 5;
      const r2 = chained();
      expect(r2.isPending).toBe(true);
      a.value = 6; // dirty again mid-flight triggers another drop of previous chain
      const r3 = chained();
      await sleep(12);
      expect(r3.isResolved).toBe(true);
      expect(r3.value).toBe(6 + 2 + 1);
    });
  });
});
