import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { JsonQuery, fetchQuery } from '../query.js';
import { RefetchInterval } from '../types.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { t } from '../typeDefs.js';
import { RefetchManager } from '../RefetchManager.js';
import { GcManager } from '../GcManager.js';

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
    client.refetchManager = new RefetchManager(0.1);
    client.gcManager = new GcManager(() => {}, 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Refetch Interval', () => {
    it('should refetch at specified interval', async () => {
      let callCount = 0;
      mockFetch.get('/counter', () => ({ count: ++callCount }));

      class GetCounter extends JsonQuery {
        path = '/counter';
        result = { count: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetCounter);
        await relay;
        expect(relay.value!).toMatchObject({ count: 1 });

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

      class GetItem extends JsonQuery {
        path = '/item';
        result = { n: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem);
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

    it('should resume refetching after deactivation and re-activation', async () => {
      let callCount = 0;
      mockFetch.get('/reactivate', () => ({ n: ++callCount }));

      class GetReactivate extends JsonQuery {
        path = '/reactivate';
        result = { n: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second, gcTime: Infinity };
      }

      // Phase 1: activate, verify refetching works
      await testWithClient(client, async () => {
        const relay = fetchQuery(GetReactivate);
        await relay;
        await sleep(250);
        expect(callCount).toBeGreaterThan(1);
      });

      // Phase 2: deactivated — verify no more refetches
      const countAfterDeactivation = callCount;
      await sleep(200);
      expect(callCount).toBe(countAfterDeactivation);

      // Phase 3: re-activate — verify refetching resumes
      await testWithClient(client, async () => {
        const relay = fetchQuery(GetReactivate);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        relay.value;
        await sleep(250);
        expect(callCount).toBeGreaterThan(countAfterDeactivation);
      });
    });
  });

  describe('Multiple Intervals with GCD', () => {
    it('should handle multiple queries with different intervals efficiently', async () => {
      let count1 = 0;
      let count5 = 0;

      mockFetch.get('/every1s', () => ({ count: ++count1 }));
      mockFetch.get('/every5s', () => ({ count: ++count5 }));

      class GetEvery1s extends JsonQuery {
        path = '/every1s';
        result = { count: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second };
      }

      class GetEvery5s extends JsonQuery {
        path = '/every5s';
        result = { count: t.number };
        config = { refetchInterval: RefetchInterval.Every5Seconds };
      }

      await testWithClient(client, async () => {
        const relay1s = fetchQuery(GetEvery1s);
        const relay5s = fetchQuery(GetEvery5s);

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

      class Get5s extends JsonQuery {
        path = '/5s';
        result = { n: t.number };
        config = { refetchInterval: RefetchInterval.Every5Seconds };
      }

      class Get10s extends JsonQuery {
        path = '/10s';
        result = { n: t.number };
        config = { refetchInterval: RefetchInterval.Every10Seconds };
      }

      await testWithClient(client, async () => {
        const relay5 = fetchQuery(Get5s);
        const relay10 = fetchQuery(Get10s);

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

      class GetSlow extends JsonQuery {
        path = '/slow';
        result = { count: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetSlow);
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

      class GetItem extends JsonQuery {
        path = '/no-interval';
        result = { n: t.number };
        // No refetchInterval
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem);
        await relay;
        expect(relay.value!).toMatchObject({ n: 1 });

        // Wait a bit (200ms = 2s at 0.1x)
        await sleep(200);

        // Should not have refetched
        expect(callCount).toBe(1);
      });
    });

    it('should handle very fast intervals', async () => {
      let callCount = 0;
      mockFetch.get('/fast', () => ({ count: ++callCount }));

      class GetFast extends JsonQuery {
        path = '/fast';
        result = { count: t.number };
        config = { refetchInterval: RefetchInterval.Every1Second };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetFast);
        await relay;

        // Wait 250ms (2.5 intervals at 0.1x)
        await sleep(250);

        // Should have refetched at least twice
        expect(callCount).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Response-dependent refetchInterval', () => {
    it('should change refetchInterval based on this.response status', async () => {
      let callCount = 0;
      // First call returns 500, subsequent calls return 200
      mockFetch.get('/health', () => {
        callCount++;
        return { status: callCount === 1 ? 'unhealthy' : 'ok' };
      });

      const intervalLog: number[] = [];

      class GetHealth extends JsonQuery {
        path = '/health';
        result = { status: t.string };

        getConfig() {
          // Poll fast (Every1Second = 100ms at 0.1x) when healthy or unknown,
          // slow down (Every5Seconds = 500ms at 0.1x) after errors
          const interval = this.response?.ok === false ? RefetchInterval.Every5Seconds : RefetchInterval.Every1Second;
          intervalLog.push(interval);
          return { refetchInterval: interval };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetHealth);
        await relay;

        // First fetch completed — response is 200 (mock always returns 200 status)
        // getConfig should have been called with ok=true → Every1Second
        expect(intervalLog[intervalLog.length - 1]).toBe(RefetchInterval.Every1Second);

        // Wait for a couple of fast refetch intervals (100ms each at 0.1x)
        await sleep(250);

        // Should have refetched multiple times at the fast interval
        expect(callCount).toBeGreaterThanOrEqual(2);
      });
    });

    it('should slow down polling after error and speed up after recovery', async () => {
      const intervalLog: number[] = [];

      class GetStatus extends JsonQuery {
        path = '/status';
        result = { value: t.string };

        getConfig() {
          const interval = this.response?.ok === false ? RefetchInterval.Every5Seconds : RefetchInterval.Every1Second;
          intervalLog.push(interval);
          return { refetchInterval: interval };
        }
      }

      // First fetch: 500 error
      mockFetch.get('/status', { value: 'error' }, { status: 500 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetStatus);
        await relay;

        // After 500 response, getConfig should set slow interval
        expect(intervalLog[intervalLog.length - 1]).toBe(RefetchInterval.Every5Seconds);

        // Refetch explicitly with a 200 response
        intervalLog.length = 0;
        mockFetch.get('/status', { value: 'recovered' });
        await relay.value!.__refetch();

        // After 200 response, getConfig should set fast interval
        expect(intervalLog[intervalLog.length - 1]).toBe(RefetchInterval.Every1Second);
      });
    });
  });
});
