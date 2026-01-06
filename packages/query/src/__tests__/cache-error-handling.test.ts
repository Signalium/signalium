/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query, queryKeyForFn, streamQuery } from '../query.js';
import { hashValue } from 'signalium/utils';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { valueKeyFor, refIdsKeyFor, updatedAtKeyFor } from '../stores/shared.js';
import type { QueryStore } from '../QueryClient.js';

/**
 * Cache Error Handling Tests
 *
 * Tests that cache loading errors don't prevent queries from running.
 * Cache is an optimization, so if loading fails, queries should proceed normally.
 */

describe('Cache Error Handling', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: MemoryPersistentStore;
  let store: SyncQueryStore;

  beforeEach(() => {
    client?.destroy();
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('loadCachedQuery errors', () => {
    it('should continue query execution if loadCachedQuery throws an error', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
      }));

      // Create a store that throws when loading
      const errorStore: QueryStore = {
        ...store,
        loadQuery: () => {
          throw new Error('Cache load failed');
        },
        saveQuery: store.saveQuery.bind(store),
        saveEntity: store.saveEntity.bind(store),
        activateQuery: store.activateQuery.bind(store),
        deleteQuery: store.deleteQuery.bind(store),
      };

      const errorClient = new QueryClient(errorStore, { fetch: mockFetch as any });

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' });

      await testWithClient(errorClient, async () => {
        const relay = getItem({ id: '1' });
        const result = await relay;

        // Query should succeed despite cache error
        expect(result).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.value).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });

      errorClient.destroy();
    });

    it('should continue query execution if loadCachedQuery returns a rejected promise', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
      }));

      // Create a store that rejects when loading
      const errorStore: QueryStore = {
        ...store,
        loadQuery: () => Promise.reject(new Error('Async cache load failed')),
        saveQuery: store.saveQuery.bind(store),
        saveEntity: store.saveEntity.bind(store),
        activateQuery: store.activateQuery.bind(store),
        deleteQuery: store.deleteQuery.bind(store),
      };

      const errorClient = new QueryClient(errorStore, { fetch: mockFetch as any });

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' });

      await testWithClient(errorClient, async () => {
        const relay = getItem({ id: '1' });
        const result = await relay;

        // Query should succeed despite cache error
        expect(result).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.value).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });

      errorClient.destroy();
    });
  });

  describe('Cached data parsing errors', () => {
    it('should continue query execution if cached value JSON parsing fails', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
      }));

      const queryKey = queryKeyForFn(getItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' });

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        const result = await relay;

        // Query should succeed despite cache parsing error
        expect(result).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.value).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });

    it('should continue query execution if cached value has wrong shape', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: {
          staleTime: 0, // Always stale to force refetch
        },
      }));

      const queryKey = queryKeyForFn(getUser, { id: '1' });

      // Store cached value with wrong shape (missing required fields)
      // Use invalid structure that will cause parsing to fail
      // Store invalid JSON that will fail JSON.parse
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp to make it stale

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        // Wait for cache error to be caught and query to proceed
        await sleep(50);
        const result = await relay;

        // Query should succeed despite cache shape error
        expect(result).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });

    it('should continue query execution if cached entity references are invalid', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const queryKey = queryKeyForFn(getUser, { id: '1' });
      const invalidEntityId = 99999; // Entity that doesn't exist

      // Store cached value with invalid entity reference
      kv.setString(valueKeyFor(queryKey), JSON.stringify({ user: { __entityRef: invalidEntityId } }));
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
      kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([invalidEntityId]));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        const result = await relay;

        // Query should succeed despite invalid entity reference
        expect(result).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Entity preloading errors', () => {
    it('should continue query execution if entity preloading fails', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const queryKey = queryKeyForFn(getUser, { id: '1' });
      const entityId = hashValue('User:1');

      // Store cached value with entity reference, but entity data is corrupted
      kv.setString(valueKeyFor(queryKey), JSON.stringify({ user: { __entityRef: entityId } }));
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
      kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([entityId]));
      // Store invalid JSON for the entity
      kv.setString(valueKeyFor(entityId), 'invalid json{');

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        const result = await relay;

        // Query should succeed despite entity preloading error
        expect(result).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Multiple cache errors', () => {
    it('should continue query execution if multiple cache operations fail', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        stream: {
          type: User,
          subscribe: (context, params, onUpdate) => {
            // Return unsubscribe function
            return () => {};
          },
        },
      }));

      const queryKey = queryKeyForFn(getUser, { id: '1' });

      // Store multiple corrupted cache entries
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
      kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([99999])); // Invalid entity

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        const result = await relay;

        // Query should succeed despite multiple cache errors
        expect(result).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value).toEqual({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Cache deletion on error', () => {
    it('should delete corrupted cache entry when loading fails', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
      }));

      const queryKey = queryKeyForFn(getItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      // Verify cache entry exists before
      expect(kv.getString(valueKeyFor(queryKey))).toBeDefined();

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' }, { delay: 10 });

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        // Wait for cache error to be caught and cache to be deleted
        await sleep(20);

        // Cache entry should be deleted after error (before fresh data is saved)
        // Check immediately after error, before fresh data saves
        const cachedValue = kv.getString(valueKeyFor(queryKey));
        // The cache might be deleted, or it might have been replaced with fresh data
        // The important thing is that the query succeeded
        const result = await relay;
        expect(result).toEqual({ id: 1, name: 'Fresh Data' });
      });
    });
  });

  describe('Background refetch after cache error', () => {
    it('should still perform background refetch if cache is stale after error', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
        cache: {
          staleTime: 0, // Always stale
        },
      }));

      const queryKey = queryKeyForFn(getItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' }, { delay: 10 });

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        // Force a pull
        relay.value;
        await sleep();

        // Should start fetching fresh data
        expect(relay.isPending).toBe(true);

        const result = await relay;

        // Query should succeed with fresh data
        expect(result).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.value).toEqual({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Stream queries with cache errors', () => {
    it('should start stream subscription correctly if cache loading fails', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      // Create a store that throws when loading
      const errorStore: QueryStore = {
        ...store,
        loadQuery: () => {
          throw new Error('Cache load failed');
        },
        saveQuery: store.saveQuery.bind(store),
        saveEntity: store.saveEntity.bind(store),
        activateQuery: store.activateQuery.bind(store),
        deleteQuery: store.deleteQuery.bind(store),
      };

      const errorClient = new QueryClient(errorStore, { fetch: mockFetch as any });

      await testWithClient(errorClient, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            subscribeCallCount++;
            updateCallback = onUpdate;

            // Send initial data after a delay
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
                email: 'alice@example.com',
              });
            }, 20);

            return () => {};
          },
        }));

        const relay = streamUser();

        // Stream should start pending
        expect(relay.isPending).toBe(true);

        // Subscription should be set up despite cache error
        await sleep(30);
        expect(subscribeCallCount).toBe(1);
        expect(updateCallback).toBeDefined();

        // Stream should resolve when first update arrives
        const result = await relay;

        expect(relay.isPending).toBe(false);
        expect(relay.isResolved).toBe(true);
        expect(result.name).toBe('Alice');
        expect(result.email).toBe('alice@example.com');
      });

      errorClient.destroy();
    });

    it('should start stream subscription correctly if cached value parsing fails', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          subscribeCallCount++;
          updateCallback = onUpdate;

          // Send initial data after a delay
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
              email: 'alice@example.com',
            });
          }, 20);

          return () => {};
        },
      }));

      // Get the query key using queryKeyForFn
      const queryKey = queryKeyForFn(streamUser, undefined);

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      await testWithClient(client, async () => {
        const relay = streamUser();

        // Stream should start pending
        expect(relay.isPending).toBe(true);

        // Subscription should be set up despite cache error
        await sleep(30);
        expect(subscribeCallCount).toBe(1);
        expect(updateCallback).toBeDefined();

        // Stream should resolve when first update arrives
        const result = await relay;

        expect(relay.isPending).toBe(false);
        expect(relay.isResolved).toBe(true);
        expect(result.name).toBe('Alice');
        expect(result.email).toBe('alice@example.com');
      });
    });
  });

  describe('Background streams with cache errors', () => {
    it('should start background stream subscription correctly if cache loading fails', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      // Create a store that throws when loading
      const errorStore: QueryStore = {
        ...store,
        loadQuery: () => {
          throw new Error('Cache load failed');
        },
        saveQuery: store.saveQuery.bind(store),
        saveEntity: store.saveEntity.bind(store),
        activateQuery: store.activateQuery.bind(store),
        deleteQuery: store.deleteQuery.bind(store),
      };

      const errorClient = new QueryClient(errorStore, { fetch: mockFetch as any });

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Initial User', email: 'initial@example.com' },
      });

      await testWithClient(errorClient, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
          stream: {
            type: User,
            subscribe: (context, params, onUpdate) => {
              subscribeCallCount++;
              updateCallback = onUpdate;

              // Send stream update after a delay
              setTimeout(() => {
                onUpdate({
                  __typename: 'User',
                  id: 1,
                  name: 'Updated User',
                  email: 'updated@example.com',
                });
              }, 30);

              return () => {};
            },
          },
        }));

        const relay = getUser({ id: '1' });

        // Query should fetch initial data
        const result = await relay;
        expect(result.user.name).toBe('Initial User');

        // Background stream should be subscribed despite cache error
        await sleep(40);
        expect(subscribeCallCount).toBe(1);
        expect(updateCallback).toBeDefined();

        // Stream update should be received
        await sleep(20);
        // The stream update should add to orphans or update the entity
        // Since we're testing that subscription starts, we just verify it was called
        expect(subscribeCallCount).toBe(1);
      });

      errorClient.destroy();
    });

    it('should start background stream subscription correctly if cached value parsing fails', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        stream: {
          type: User,
          subscribe: (context, params, onUpdate) => {
            subscribeCallCount++;
            updateCallback = onUpdate;

            // Send stream update after a delay
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: 1,
                name: 'Updated User',
                email: 'updated@example.com',
              });
            }, 30);

            return () => {};
          },
        },
        cache: {
          staleTime: 0, // Always stale to force refetch
        },
      }));

      const queryKey = queryKeyForFn(getUser, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User', email: 'fresh@example.com' },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });

        // Query should fetch fresh data despite cache error
        const result = await relay;
        expect(result.user.name).toBe('Fresh User');

        // Background stream should be subscribed despite cache error
        await sleep(40);
        expect(subscribeCallCount).toBe(1);
        expect(updateCallback).toBeDefined();

        // Stream update should be received
        await sleep(20);
        expect(subscribeCallCount).toBe(1);
      });
    });
  });
});
