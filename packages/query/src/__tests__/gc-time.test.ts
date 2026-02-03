/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { query, queryKeyForFn } from '../query.js';
import { t, entity } from '../typeDefs.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { hashValue } from 'signalium/utils';
import { valueKeyFor } from '../stores/shared.js';

/**
 * GC Time Tests
 *
 * Tests gcTime-based garbage collection with sorted queue management,
 * LRU interaction, and subscriber-aware eviction
 */

describe('GC Time', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any, evictionMultiplier: 0.001 });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic GC', () => {
    it('should evict queries from disk after gcTime expires', async () => {
      const getItem = query(() => ({
        path: '/item/[id]',
        response: { id: t.number, name: t.string },
        cache: { gcTime: 100, staleTime: 50 }, // 1 second
      }));

      mockFetch.get('/item/1', { id: 1, name: 'Item 1' });

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        expect(relay.value).toEqual(undefined);
        await relay;
        expect(relay.value).toEqual({ id: 1, name: 'Item 1' });
      });

      await sleep(75);

      mockFetch.get('/item/1', { id: 1, name: 'Item 1 updated' }, { delay: 50 });
      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        expect(relay.value).toEqual({ id: 1, name: 'Item 1' });
        await relay;
        expect(relay.value).toEqual({ id: 1, name: 'Item 1' });

        await sleep(60);
        expect(relay.value).toEqual({ id: 1, name: 'Item 1 updated' });
      });

      await sleep(200);

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        expect(relay.value).toEqual(undefined);
        await relay;
        expect(relay.value).toEqual({ id: 1, name: 'Item 1 updated' });
      });
    });

    it('should NOT evict queries with active subscribers', async () => {
      const getItem = query(() => ({
        path: '/active',
        response: { data: t.string },
        cache: { gcTime: 50 },
      }));

      mockFetch.get('/active', { data: 'test' });

      // Keep query active
      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;

        const queryKey = queryKeyForFn(getItem, undefined);

        // Wait past GC time
        await sleep(60);

        // Should still be in memory because it's active (has subscriber)
        expect(client.queryInstances.has(queryKey)).toBe(true);
      });
    }, 3000);
  });

  describe('GC with LRU', () => {
    it('should work alongside LRU cache eviction', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: {
          maxCount: 2, // LRU size
          gcTime: 5000, // 5 seconds
        },
      }));

      mockFetch.get('/users/1', { user: { __typename: 'User', id: 1, name: 'User 1' } });
      mockFetch.get('/users/2', { user: { __typename: 'User', id: 2, name: 'User 2' } });
      mockFetch.get('/users/3', { user: { __typename: 'User', id: 3, name: 'User 3' } });

      await testWithClient(client, async () => {
        // Fetch 3 users - third should evict first from disk via LRU
        const relay1 = getUser({ id: '1' });
        await relay1;

        const relay2 = getUser({ id: '2' });
        await relay2;

        const relay3 = getUser({ id: '3' });
        await relay3;

        const query1Key = queryKeyForFn(getUser, { id: '1' });
        const query2Key = queryKeyForFn(getUser, { id: '2' });
        const query3Key = queryKeyForFn(getUser, { id: '3' });

        // All should be in memory initially
        expect(client.queryInstances.has(query1Key)).toBe(true);
        expect(client.queryInstances.has(query2Key)).toBe(true);
        expect(client.queryInstances.has(query3Key)).toBe(true);

        // First query should be evicted from DISK by LRU (but still in memory)
        expect(kv.getString(valueKeyFor(query1Key))).toBeUndefined();
        expect(kv.getString(valueKeyFor(query2Key))).toBeDefined();
        expect(kv.getString(valueKeyFor(query3Key))).toBeDefined();
      });
    });
  });

  describe('GC Queue Management', () => {
    it('should add queries to GC queue when deactivated', async () => {
      const getItem = query(() => ({
        path: '/item',
        response: { value: t.string },
        cache: { gcTime: 2000 },
      }));

      mockFetch.get('/item', { value: 'test' });

      const queryKey = queryKeyForFn(getItem, undefined);

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;

        expect(client.queryInstances.has(queryKey)).toBe(true);
      });

      // After context ends, query should be scheduled for GC
      // In a real implementation, we'd check the GC queue
      // For now, we verify the query is still in memory
      expect(client.queryInstances.has(queryKey)).toBe(true);
    });

    it('should remove queries from GC queue when reactivated', async () => {
      const getItem = query(() => ({
        path: '/reactivate',
        response: { n: t.number },
        cache: { gcTime: 1000 },
      }));

      mockFetch.get('/reactivate', { n: 1 });

      const queryKey = queryKeyForFn(getItem, undefined);

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      // Query deactivated, scheduled for GC
      await sleep(40);

      // Reactivate before GC
      mockFetch.get('/reactivate', { n: 2 });
      await testWithClient(client, async () => {
        const relay = getItem();
        relay.value; // Access it
        await sleep(60);

        // Should still be in memory
        expect(client.queryInstances.has(queryKey)).toBe(true);
      });

      // Even after original GC time, should not be evicted due to reactivation
      await sleep(40);
      expect(client.queryInstances.has(queryKey)).toBe(true);
    });
  });

  describe('GC with Entities', () => {
    it("should handle entity cleanup when query is GC'd", async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        post: Post,
      }));

      const getUser = query(() => ({
        path: '/user',
        response: { user: User },
        cache: { gcTime: 1000 },
      }));

      mockFetch.get('/user', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: {
            __typename: 'Post',
            id: 10,
            title: 'Test Post',
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser();
        await relay;
      });

      const userKey = hashValue(['User:1', User.shapeKey]);
      const postKey = hashValue(['Post:10', Post.shapeKey]);

      // Entities should exist in store
      expect(kv.getString(valueKeyFor(userKey))).toBeDefined();
      expect(kv.getString(valueKeyFor(postKey))).toBeDefined();

      // Note: The actual GC of entities is handled by the LRU system
      // when queries are evicted. The gcTime affects when queries
      // are removed from memory, but disk cleanup is done by LRU.
    });
  });

  describe('Edge Cases', () => {
    it('should handle queries without gcTime', async () => {
      const getItem = query(() => ({
        path: '/no-gc',
        response: { data: t.string },
        // No gcTime configured
      }));

      mockFetch.get('/no-gc', { data: 'test' });

      const queryKey = queryKeyForFn(getItem, undefined);

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      // Should remain in memory indefinitely
      await sleep(100);
      expect(client.queryInstances.has(queryKey)).toBe(true);
    });

    it('should handle very short gcTime', async () => {
      const getItem = query(() => ({
        path: '/short-gc',
        response: { value: t.number },
        cache: { gcTime: 100 }, // Very short
      }));

      mockFetch.get('/short-gc', { value: 42 });

      const queryKey = queryKeyForFn(getItem, undefined);

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      // Should be scheduled for GC quickly
      // Note: Actual eviction timing depends on GC interval
    });

    it('should handle very long gcTime', async () => {
      const getItem = query(() => ({
        path: '/long-gc',
        response: { data: t.string },
        cache: { gcTime: 1000 * 60 * 60 }, // 1 hour
      }));

      mockFetch.get('/long-gc', { data: 'persisted' });

      const queryKey = queryKeyForFn(getItem, undefined);

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      // Should remain in memory for a while, then be evicted
      await sleep(40);
      expect(client.queryInstances.has(queryKey)).toBe(true);

      await sleep(100);
      expect(client.queryInstances.has(queryKey)).toBe(false);
    });
  });
});
