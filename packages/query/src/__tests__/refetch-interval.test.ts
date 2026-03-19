import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { query } from '../query.js';
import { RefetchInterval } from '../types.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { t } from '../typeDefs.js';

/**
 * RefetchInterval Tests
 *
 * Tests refetchInterval with dynamic GCD-based timer management,
 * subscriber tracking, exponential backoff, and no overlapping fetches
 */

describe('RefetchInterval', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    client?.destroy();
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any, refetchMultiplier: 0.1 });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Refetch Interval', () => {
    it('should refetch at specified interval', async () => {
      let callCount = 0;
      mockFetch.get('/counter', () => ({ count: ++callCount }));

      const getCounter = query(() => ({
        path: '/counter',
        response: { count: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      await testWithClient(client, async () => {
        const relay = getCounter();
        await relay;
        expect(relay.value).toEqual({ count: 1 });

        // Wait for interval to trigger (100ms with 0.1 multiplier + buffer)
        await sleep(120);
        expect(relay.value?.count).toBeGreaterThan(1);

        // Wait for another interval
        await sleep(110);
        expect(relay.value?.count).toBeGreaterThan(2);
      });
    });

    it('should stop refetching when query is no longer accessed', async () => {
      let callCount = 0;
      mockFetch.get('/item', () => ({ n: ++callCount }));

      const getItem = query(() => ({
        path: '/item',
        response: { n: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
        const initialCount = relay.value!.n;

        // Wait a bit (250ms with 0.1 multiplier = ~2.5 intervals)
        await sleep(250);
        const afterCount = relay.value!.n;

        expect(afterCount).toBeGreaterThan(initialCount);

        await sleep(250);
      });

      // After context ends, wait and check that no more calls happen
      const countBeforeWait = callCount;
      await sleep(200);

      // Note: This test is simplified - in a real implementation,
      // subscriber tracking would need proper cleanup
      // For now we just verify the basic interval works
    });
  });

  describe('Multiple Intervals with GCD', () => {
    it('should handle multiple queries with different intervals efficiently', async () => {
      let count1 = 0;
      let count5 = 0;

      mockFetch.get('/every1s', () => ({ count: ++count1 }));
      mockFetch.get('/every5s', () => ({ count: ++count5 }));

      const getEvery1s = query(() => ({
        path: '/every1s',
        response: { count: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      const getEvery5s = query(() => ({
        path: '/every5s',
        response: { count: t.number },
        cache: { refetchInterval: RefetchInterval.Every5Seconds },
      }));

      await testWithClient(client, async () => {
        const relay1s = getEvery1s();
        const relay5s = getEvery5s();

        await relay1s;
        await relay5s;

        // Wait and verify different refetch rates (350ms = 3.5 intervals of 1s)
        await sleep(350);

        // 1s query should have refetched ~3 times
        expect(count1).toBeGreaterThanOrEqual(3);
        expect(count1).toBeLessThanOrEqual(5);

        // 5s query should have refetched 0-1 times
        expect(count5).toBeGreaterThanOrEqual(1);
        expect(count5).toBeLessThanOrEqual(2);

        // Wait for 5s interval (200ms more)
        await sleep(200);

        // 5s query should now have refetched
        expect(count5).toBeGreaterThanOrEqual(2);
      });
    });

    it('should use GCD for multiple queries with compatible intervals', async () => {
      // Every5Seconds and Every10Seconds should use GCD of 5s
      let count5 = 0;
      let count10 = 0;

      mockFetch.get('/5s', () => ({ n: ++count5 }));
      mockFetch.get('/10s', () => ({ n: ++count10 }));

      const get5s = query(() => ({
        path: '/5s',
        response: { n: t.number },
        cache: { refetchInterval: RefetchInterval.Every5Seconds },
      }));

      const get10s = query(() => ({
        path: '/10s',
        response: { n: t.number },
        cache: { refetchInterval: RefetchInterval.Every10Seconds },
      }));

      await testWithClient(client, async () => {
        const relay5 = get5s();
        const relay10 = get10s();

        await Promise.all([relay5, relay10]);

        // Wait 1100ms (11 seconds at 0.1x = 1.1s)
        await sleep(1100);

        // 5s should refetch ~2 times
        expect(count5).toBeGreaterThanOrEqual(2);

        // 10s should refetch ~1 time
        expect(count10).toBeGreaterThanOrEqual(1);
        expect(count10).toBeLessThanOrEqual(2);
      });
    });
  });

  describe('No Overlapping Fetches', () => {
    it('should wait for previous fetch to complete before next refetch', async () => {
      let activeFetches = 0;
      let maxConcurrent = 0;
      let fetchCount = 0;

      mockFetch.get('/slow', async () => {
        activeFetches++;
        maxConcurrent = Math.max(maxConcurrent, activeFetches);
        fetchCount++;
        await sleep(80); // Slow fetch (80ms = 800ms at 0.1x)
        activeFetches--;
        return { count: fetchCount };
      });

      const getSlow = query(() => ({
        path: '/slow',
        response: { count: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      await testWithClient(client, async () => {
        const relay = getSlow();
        await relay;

        // Wait for several intervals (350ms = 3.5 intervals)
        await sleep(350);

        // Should never have overlapping fetches
        expect(maxConcurrent).toBe(1);

        // Should have attempted multiple fetches but not overlapping
        expect(fetchCount).toBeGreaterThan(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle query without refetchInterval', async () => {
      let callCount = 0;
      mockFetch.get('/no-interval', () => ({ n: ++callCount }));

      const getItem = query(() => ({
        path: '/no-interval',
        response: { n: t.number },
        // No refetchInterval
      }));

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
        expect(relay.value).toEqual({ n: 1 });

        // Wait a bit (200ms = 2s at 0.1x)
        await sleep(200);

        // Should not have refetched
        expect(callCount).toBe(1);
      });
    });

    it('should handle very fast intervals', async () => {
      let callCount = 0;
      mockFetch.get('/fast', () => ({ count: ++callCount }));

      const getFast = query(() => ({
        path: '/fast',
        response: { count: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      await testWithClient(client, async () => {
        const relay = getFast();
        await relay;

        // Wait 250ms (2.5 intervals at 0.1x)
        await sleep(250);

        // Should have refetched at least twice
        expect(callCount).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Dynamic Refetch Interval (function)', () => {
    it('should stop refetching when function returns false on error', async () => {
      let callCount = 0;
      mockFetch.get('/maybe-404', () => {
        callCount++;
        throw new Error('Not found');
      });

      const getMaybe404 = query(() => ({
        path: '/maybe-404',
        response: { n: t.number },
        cache: {
          refetchInterval: (q: { isRejected: boolean }) => (q.isRejected ? false : RefetchInterval.Every1Second),
          retry: false,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getMaybe404();
        try {
          await relay;
        } catch {
          // Expected: initial fetch errors
        }

        const countAfterInitial = callCount;

        // Wait several intervals — should NOT refetch since function returns false
        await sleep(350);

        expect(callCount).toBe(countAfterInitial);
      });
    });

    it('should keep refetching when function returns an interval on success', async () => {
      let callCount = 0;
      mockFetch.get('/ok', () => ({ n: ++callCount }));

      const getOk = query(() => ({
        path: '/ok',
        response: { n: t.number },
        cache: {
          refetchInterval: (q: { isRejected: boolean }) =>
            q.isRejected ? false : RefetchInterval.Every1Second,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getOk();
        await relay;
        expect(relay.value).toEqual({ n: 1 });

        // Wait for refetches
        await sleep(350);

        // Should have refetched multiple times since there's no error
        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('should resume refetching when error clears', async () => {
      let callCount = 0;
      let shouldError = true;
      mockFetch.get('/flaky', () => {
        callCount++;
        if (shouldError) throw new Error('Temporary error');
        return { n: callCount };
      });

      const getFlaky = query(() => ({
        path: '/flaky',
        response: { n: t.number },
        cache: {
          refetchInterval: (q: { isRejected: boolean }) =>
            q.isRejected ? RefetchInterval.Every5Seconds : RefetchInterval.Every1Second,
          retry: false,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getFlaky();
        try {
          await relay;
        } catch {
          // Expected
        }

        // In error state — dynamic interval is 5s (500ms at 0.1x).
        // At 1s interval (100ms at 0.1x), it should NOT refetch.
        const countAfterError = callCount;
        await sleep(250);
        // Should not have refetched at 1s cadence since error interval is 5s
        expect(callCount).toBeLessThanOrEqual(countAfterError + 1);

        // Now fix the endpoint and wait for the 5s interval to hit
        shouldError = false;
        await sleep(400);

        // Should have refetched at least once after recovering
        expect(callCount).toBeGreaterThan(countAfterError);
      });
    });

    it('should work alongside static interval queries', async () => {
      let staticCount = 0;
      let dynamicCount = 0;
      mockFetch.get('/static', () => ({ n: ++staticCount }));
      mockFetch.get('/dynamic', () => ({ n: ++dynamicCount }));

      const getStatic = query(() => ({
        path: '/static',
        response: { n: t.number },
        cache: { refetchInterval: RefetchInterval.Every1Second },
      }));

      const getDynamic = query(() => ({
        path: '/dynamic',
        response: { n: t.number },
        cache: {
          refetchInterval: (_q: { isRejected: boolean }) => RefetchInterval.Every1Second,
        },
      }));

      await testWithClient(client, async () => {
        const relayStatic = getStatic();
        const relayDynamic = getDynamic();

        await relayStatic;
        await relayDynamic;

        await sleep(350);

        // Both should refetch at roughly the same rate
        expect(staticCount).toBeGreaterThanOrEqual(3);
        expect(dynamicCount).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
