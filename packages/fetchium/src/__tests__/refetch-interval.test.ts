import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { t } from '../typeDefs.js';
import { GcManager } from '../GcManager.js';
import { poll } from '../subscriptions/polling.js';

/**
 * Poll-based Subscription Tests
 *
 * Tests poll() subscribe factory with per-query timers,
 * subscriber tracking, no overlapping fetches, and getInterval support.
 */

describe('Poll Subscribe', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    client?.destroy();
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
    client.gcManager = new GcManager(() => {}, 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Polling', () => {
    it('should refetch at specified interval', async () => {
      let callCount = 0;
      mockFetch.get('/counter', () => ({ count: ++callCount }));

      class GetCounter extends RESTQuery {
        path = '/counter';
        result = { count: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetCounter);
        await relay;
        expect(relay.value!).toMatchObject({ count: 1 });

        await sleep(120);
        expect(relay.value?.count).toBeGreaterThan(1);

        await sleep(110);
        expect(relay.value?.count).toBeGreaterThan(2);
      });
    });

    it('should stop polling when query is no longer accessed', async () => {
      let callCount = 0;
      mockFetch.get('/item', () => ({ n: ++callCount }));

      class GetItem extends RESTQuery {
        path = '/item';
        result = { n: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem);
        await relay;
        const initialCount = relay.value!.n;

        await sleep(250);
        const afterCount = relay.value!.n;

        expect(afterCount).toBeGreaterThan(initialCount);
      });

      const countBeforeWait = callCount;
      await sleep(200);
      expect(callCount).toBe(countBeforeWait);
    });

    it('should resume polling after deactivation and re-activation', async () => {
      let callCount = 0;
      mockFetch.get('/reactivate', () => ({ n: ++callCount }));

      class GetReactivate extends RESTQuery {
        path = '/reactivate';
        result = { n: t.number };
        config = { gcTime: Infinity, subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetReactivate);
        await relay;
        await sleep(250);
        expect(callCount).toBeGreaterThan(1);
      });

      const countAfterDeactivation = callCount;
      await sleep(200);
      expect(callCount).toBe(countAfterDeactivation);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetReactivate);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        relay.value;
        await sleep(250);
        expect(callCount).toBeGreaterThan(countAfterDeactivation);
      });
    });
  });

  describe('Multiple Intervals', () => {
    it('should handle multiple queries with different intervals independently', async () => {
      let count1 = 0;
      let count5 = 0;

      mockFetch.get('/every100ms', () => ({ count: ++count1 }));
      mockFetch.get('/every500ms', () => ({ count: ++count5 }));

      class GetEvery100ms extends RESTQuery {
        path = '/every100ms';
        result = { count: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      class GetEvery500ms extends RESTQuery {
        path = '/every500ms';
        result = { count: t.number };
        config = { subscribe: poll({ interval: 500 }) };
      }

      await testWithClient(client, async () => {
        const relay100 = fetchQuery(GetEvery100ms);
        const relay500 = fetchQuery(GetEvery500ms);

        await relay100;
        await relay500;

        await sleep(350);

        expect(count1).toBeGreaterThanOrEqual(3);
        expect(count1).toBeLessThanOrEqual(5);

        expect(count5).toBeGreaterThanOrEqual(1);
        expect(count5).toBeLessThanOrEqual(2);

        await sleep(200);

        expect(count5).toBeGreaterThanOrEqual(2);
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
        await sleep(80);
        activeFetches--;
        return { count: fetchCount };
      });

      class GetSlow extends RESTQuery {
        path = '/slow';
        result = { count: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetSlow);
        await relay;

        await sleep(350);

        expect(maxConcurrent).toBe(1);
        expect(fetchCount).toBeGreaterThan(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle query without poll subscribe', async () => {
      let callCount = 0;
      mockFetch.get('/no-interval', () => ({ n: ++callCount }));

      class GetItem extends RESTQuery {
        path = '/no-interval';
        result = { n: t.number };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem);
        await relay;
        expect(relay.value!).toMatchObject({ n: 1 });

        await sleep(200);

        expect(callCount).toBe(1);
      });
    });

    it('should handle fast intervals', async () => {
      let callCount = 0;
      mockFetch.get('/fast', () => ({ count: ++callCount }));

      class GetFast extends RESTQuery {
        path = '/fast';
        result = { count: t.number };
        config = { subscribe: poll({ interval: 50 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetFast);
        await relay;

        await sleep(250);

        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });
  });

  describe('getConfig subscribe', () => {
    it('supports getConfig() for dynamic poll configuration', async () => {
      let callCount = 0;
      mockFetch.get('/gs-dynamic', () => ({ v: ++callCount }));

      class GetGsDynamic extends RESTQuery {
        path = '/gs-dynamic';
        result = { v: t.number };

        getConfig() {
          return { subscribe: poll({ interval: 100 }) };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetGsDynamic);
        await relay;
        await sleep(250);
        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('getConfig can access this.response', async () => {
      let seenStatus: number | undefined;
      mockFetch.get('/gs-ctx', () => ({ v: 1 }));

      class GetGsCtx extends RESTQuery {
        path = '/gs-ctx';
        result = { v: t.number };

        getConfig() {
          seenStatus = this.response?.status;
          return { subscribe: poll({ interval: 100 }) };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetGsCtx);
        await relay;
        await sleep(150);
        expect(seenStatus).toBe(200);
      });
    });
  });
});
