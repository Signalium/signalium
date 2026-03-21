import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { t } from '../typeDefs.js';
import { poll } from '../subscriptions/polling.js';
import { GcManager } from '../GcManager.js';

describe('poll() factory', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
    client.gcManager = new GcManager(() => {}, 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Default refetch polling', () => {
    it('should trigger refetch() at the specified interval', async () => {
      let callCount = 0;
      mockFetch.get('/poll-refetch', () => ({ n: ++callCount }));

      class GetPollRefetch extends RESTQuery {
        path = '/poll-refetch';
        result = { n: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPollRefetch);
        await relay;
        expect(callCount).toBe(1);

        await sleep(100);
        expect(callCount).toBeGreaterThanOrEqual(2);

        await sleep(100);
        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('should stop polling timer on deactivation', async () => {
      let callCount = 0;
      mockFetch.get('/stop-poll', () => ({ n: ++callCount }));

      class GetStopPoll extends RESTQuery {
        path = '/stop-poll';
        result = { n: t.number };
        config = { gcTime: 0, subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetStopPoll);
        await relay;
        await sleep(120);
        expect(callCount).toBeGreaterThanOrEqual(2);
      });

      const countAfterDeactivation = callCount;
      await sleep(150);
      expect(callCount).toBe(countAfterDeactivation);
    });

    it('should restart polling on reactivation', async () => {
      let callCount = 0;
      mockFetch.get('/restart-poll', () => ({ n: ++callCount }));

      class GetRestartPoll extends RESTQuery {
        path = '/restart-poll';
        result = { n: t.number };
        config = { gcTime: Infinity, subscribe: poll({ interval: 100 }) };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetRestartPoll);
        await relay;
        await sleep(120);
      });

      const countAfterFirst = callCount;
      await sleep(150);
      expect(callCount).toBe(countAfterFirst);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetRestartPoll);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        relay.value;
        await sleep(150);
        expect(callCount).toBeGreaterThan(countAfterFirst);
      });
    });
  });

  describe('getConfig subscribe', () => {
    it('supports dynamic poll interval via getConfig()', async () => {
      let callCount = 0;
      mockFetch.get('/get-subscribe', () => ({ n: ++callCount }));

      class GetWithGetSubscribe extends RESTQuery {
        path = '/get-subscribe';
        result = { n: t.number };

        getConfig() {
          return { subscribe: poll({ interval: 100 }) };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetWithGetSubscribe);
        await relay;
        expect(callCount).toBe(1);

        await sleep(250);
        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('getConfig subscribe overrides static config subscribe', async () => {
      let callCount = 0;
      mockFetch.get('/precedence', () => ({ n: ++callCount }));

      class GetPrecedence extends RESTQuery {
        path = '/precedence';
        result = { n: t.number };

        config = { subscribe: poll({ interval: 2000 }) };

        getConfig() {
          return { subscribe: poll({ interval: 100 }) };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrecedence);
        await relay;

        await sleep(250);
        expect(callCount).toBeGreaterThanOrEqual(3);
      });
    });

    it('can access this.response in getConfig', async () => {
      let seenStatus: number | undefined;
      mockFetch.get('/gs-response', () => ({ ok: true }));

      class GetGsResponse extends RESTQuery {
        path = '/gs-response';
        result = { ok: t.boolean };

        getConfig() {
          seenStatus = this.response?.status;
          return { subscribe: poll({ interval: 100 }) };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetGsResponse);
        await relay;
        await sleep(150);
        expect(seenStatus).toBe(200);
      });
    });
  });

  describe('Multiple independent polls', () => {
    it('should tick independently with different intervals', async () => {
      let fastCount = 0;
      let slowCount = 0;

      mockFetch.get('/fast', () => ({ n: ++fastCount }));
      mockFetch.get('/slow', () => ({ n: ++slowCount }));

      class GetFast extends RESTQuery {
        path = '/fast';
        result = { n: t.number };
        config = { subscribe: poll({ interval: 100 }) };
      }

      class GetSlow extends RESTQuery {
        path = '/slow';
        result = { n: t.number };
        config = { subscribe: poll({ interval: 200 }) };
      }

      await testWithClient(client, async () => {
        const relayFast = fetchQuery(GetFast);
        const relaySlow = fetchQuery(GetSlow);
        await relayFast;
        await relaySlow;

        await sleep(350);

        expect(fastCount).toBeGreaterThanOrEqual(4);
        expect(slowCount).toBeGreaterThanOrEqual(1);
        expect(slowCount).toBeLessThanOrEqual(3);
      });
    });
  });
});
