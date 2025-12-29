import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { query } from '../query.js';
import { watcher } from 'signalium';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Query Behavior Tests
 *
 * Tests query system behavior including:
 * - Error handling
 * - Path interpolation via queries
 * - Query definition caching
 * - HTTP method support
 * - Concurrent operations
 * - Memory and performance
 */

describe('Query Behavior', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockFetch.get('/item', null, {
        error: new Error('Network error'),
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow('Network error');
        expect(relay.isRejected).toBe(true);
      });
    });

    it('should handle JSON parsing errors', async () => {
      mockFetch.get('/item', null, {
        jsonError: new Error('Invalid JSON'),
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow('Invalid JSON');
      });
    });

    it('should require QueryClient context', () => {
      const getItem = query(() => ({
        path: '/item',
        response: { data: t.string },
      }));

      // Call without context should throw
      expect(() => getItem()).toThrow('QueryClient not found');
    });
  });

  describe('Path Interpolation via Queries', () => {
    it('should handle paths with no parameters', async () => {
      mockFetch.get('/static/path', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/static/path',
          response: { data: t.string },
        }));

        const relay = getItem();
        await relay;

        expect(mockFetch.calls[0].url).toBe('/static/path');
      });
    });

    it('should handle multiple path parameters', async () => {
      mockFetch.get('/org/[orgId]/team/[teamId]/user/[userId]', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/org/[orgId]/team/[teamId]/user/[userId]',
          response: { data: t.string },
        }));

        const relay = getItem({ orgId: '1', teamId: '2', userId: '3' });
        await relay;

        expect(mockFetch.calls[0].url).toContain('/org/1/team/2/user/3');
      });
    });
  });

  describe('Query Definition Caching', () => {
    it('should cache query definition across calls', async () => {
      mockFetch.get('/counter', { count: 1 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
          path: '/counter',
          response: { count: t.number },
        }));

        // Call multiple times
        const relay1 = getCounter();
        const relay2 = getCounter();
        const relay3 = getCounter();

        // Should all return the same relay (deduplication)
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        await relay1;

        // Should only fetch once
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should create definition only once per query function', async () => {
      let definitionBuildCount = 0;

      mockFetch.get('/item', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => {
          definitionBuildCount++;
          return {
            path: '/item',
            response: { data: t.string },
          };
        });

        // Call multiple times
        const relay1 = getItem();
        const relay2 = getItem();
        const relay3 = getItem();

        await Promise.all([relay1, relay2, relay3]);

        // Definition should only be built once
        expect(definitionBuildCount).toBe(1);
      });
    });
  });

  describe('HTTP Method Support', () => {
    it('should include method in query ID', async () => {
      mockFetch.get('/items', { success: true });
      mockFetch.post('/items', { success: true });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/items',
          method: 'GET',
          response: { success: t.boolean },
        }));

        const postItem = query(() => ({
          path: '/items',
          method: 'POST',
          response: { success: t.boolean },
        }));

        const relay1 = getItem();
        const relay2 = postItem();

        // Different methods should create different relays
        expect(relay1).not.toBe(relay2);

        await Promise.all([relay1, relay2]);
      });
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle race conditions safely', async () => {
      // Set up single mock response with delay - testing query deduplication
      mockFetch.get('/counter', { count: 1 }, { delay: 25 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
          path: '/counter',
          response: { count: t.number },
        }));

        // Start many concurrent requests with random delays
        const promises = [];

        for (let i = 0; i < 20; i++) {
          const relay = getCounter();
          promises.push(relay);
        }

        // All should resolve to the same value (deduplication)
        const results = await Promise.all(promises);

        // Should only fetch once despite concurrent requests
        expect(mockFetch.calls).toHaveLength(1);

        // All results should be identical
        results.forEach(result => {
          expect(result.count).toBe(1);
        });
      });
    });

    it('should handle many concurrent queries', async () => {
      // Set up 50 individual mock responses
      for (let i = 0; i < 50; i++) {
        mockFetch.get('/items/[id]', { url: `/items/${i}` });
      }

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/items/[id]',
          response: { url: t.string },
        }));

        const relays = [];

        // Create 50 concurrent queries
        for (let i = 0; i < 50; i++) {
          const relay = getItem({ id: String(i) });
          relays.push(relay);
        }

        // Wait for all to complete
        await Promise.all(relays);

        // Should have handled all queries
        expect(mockFetch.calls).toHaveLength(50);
      });
    });
  });

  describe('Memory and Watchers', () => {
    it('should cleanup watchers properly', async () => {
      mockFetch.get('/counter', { count: 1 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
          path: '/counter',
          response: { count: t.number },
        }));

        const relay = getCounter();

        // Create and immediately cleanup multiple watchers
        for (let i = 0; i < 10; i++) {
          const w = watcher(() => relay.value);
          const unsub = w.addListener(() => {});
          unsub();
        }

        // Relay should still work
        await relay;

        expect(relay.isReady).toBe(true);
      });
    });
  });
});
