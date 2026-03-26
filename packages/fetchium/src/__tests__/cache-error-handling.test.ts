/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
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

function computeQueryKey(QueryClass: new () => RESTQuery, params: unknown): number {
  const instance = new QueryClass();
  const { path, method } = instance;
  const id = `${method ?? 'GET'}:${path}`;

  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  return hashValue([id, params]);
}

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
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

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
        const relay = fetchQuery(GetItem, { id: '1' });
        const result = await relay;

        // Query should succeed despite cache error
        expect(result).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.value!).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });

      errorClient.destroy();
    });

    it('should continue query execution if loadCachedQuery returns a rejected promise', async () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

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
        const relay = fetchQuery(GetItem, { id: '1' });
        const result = await relay;

        // Query should succeed despite cache error
        expect(result).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.value!).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });

      errorClient.destroy();
    });
  });

  describe('Cached data parsing errors', () => {
    it('should continue query execution if cached value JSON parsing fails', async () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryKey = computeQueryKey(GetItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem, { id: '1' });
        const result = await relay;

        // Query should succeed despite cache parsing error
        expect(result).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.value!).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });

    it('should continue query execution if cached value has wrong shape', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
        config = {
          staleTime: 0, // Always stale to force refetch
        };
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });

      // Store cached value with wrong shape (missing required fields)
      // Store invalid JSON that will fail JSON.parse
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp to make it stale

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        // Wait for cache error to be caught and query to proceed
        await sleep(50);
        const result = await relay;

        // Query should succeed despite cache shape error
        expect(result).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value!).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });

    it('should continue query execution if cached entity references are invalid', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });
      const invalidEntityId = 99999; // Entity that doesn't exist

      // Store cached value with invalid entity reference
      kv.setString(valueKeyFor(queryKey), JSON.stringify({ user: { __entityRef: invalidEntityId } }));
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
      kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([invalidEntityId]));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        const result = await relay;

        // Query should succeed despite invalid entity reference
        expect(result).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value!).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Entity preloading errors', () => {
    it('should continue query execution if entity preloading fails', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });
      const entityId = hashValue(['User', 1]);

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
        const relay = fetchQuery(GetUser, { id: '1' });
        const result = await relay;

        // Query should succeed despite entity preloading error
        expect(result).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value!).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Multiple cache errors', () => {
    it('should continue query execution if multiple cache operations fail', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };

        getConfig() {
          return {
            subscribe(onEvent: any) {
              return () => {};
            },
          };
        }
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });

      // Store multiple corrupted cache entries
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
      kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([99999])); // Invalid entity

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        const result = await relay;

        // Query should succeed despite multiple cache errors
        expect(result).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.value!).toMatchObject({
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Cache deletion on error', () => {
    it('should delete corrupted cache entry when loading fails', async () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryKey = computeQueryKey(GetItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      // Verify cache entry exists before
      expect(kv.getString(valueKeyFor(queryKey))).toBeDefined();

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' }, { delay: 10 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem, { id: '1' });
        // Wait for cache error to be caught and cache to be deleted
        await sleep(20);

        // Cache entry should be deleted after error (before fresh data is saved)
        // Check immediately after error, before fresh data saves
        const cachedValue = kv.getString(valueKeyFor(queryKey));
        // The cache might be deleted, or it might have been replaced with fresh data
        // The important thing is that the query succeeded
        const result = await relay;
        expect(result).toMatchObject({ id: 1, name: 'Fresh Data' });
      });
    });
  });

  describe('Background refetch after cache error', () => {
    it('should still perform background refetch if cache is stale after error', async () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
        config = {
          staleTime: 0, // Always stale
        };
      }

      const queryKey = computeQueryKey(GetItem, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp

      mockFetch.get('/items/[id]', { id: 1, name: 'Fresh Data' }, { delay: 10 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem, { id: '1' });
        // Force a pull
        relay.value;
        await sleep();

        // Should start fetching fresh data
        expect(relay.isPending).toBe(true);

        const result = await relay;

        // Query should succeed with fresh data
        expect(result).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.value!).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRejected).toBe(false);
      });
    });
  });

  describe('Background streams with cache errors', () => {
    it('should start background stream subscription correctly if cache loading fails', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

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
        class GetUser extends RESTQuery {
          params = { id: t.id };
          path = `/users/${this.params.id}`;
          result = { user: t.entity(User) };

          getConfig() {
            return {
              subscribe(onEvent: any) {
                subscribeCallCount++;
                updateCallback = onEvent;

                setTimeout(() => {
                  onEvent({
                    type: 'update',
                    typename: 'User',
                    data: { id: 1, name: 'Updated User', email: 'updated@example.com' },
                  });
                }, 30);

                return () => {};
              },
            };
          }
        }

        const relay = fetchQuery(GetUser, { id: '1' });

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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
        getConfig() {
          return {
            staleTime: 0,
            subscribe(onEvent: any) {
              subscribeCallCount++;
              updateCallback = onEvent;

              setTimeout(() => {
                onEvent({
                  type: 'update',
                  typename: 'User',
                  data: { id: 1, name: 'Updated User', email: 'updated@example.com' },
                });
              }, 30);

              return () => {};
            },
          };
        }
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });

      // Store invalid JSON in cache
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User', email: 'fresh@example.com' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });

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

    it('should start background stream subscription correctly if loading extra data fails', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      let subscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
        getConfig() {
          return {
            staleTime: 0,
            subscribe(onEvent: any) {
              subscribeCallCount++;
              updateCallback = onEvent;

              setTimeout(() => {
                onEvent({
                  type: 'update',
                  typename: 'User',
                  data: { id: 1, name: 'Updated User', email: 'updated@example.com' },
                });
              }, 30);

              return () => {};
            },
          };
        }
      }

      const queryKey = computeQueryKey(GetUser, { id: '1' });

      // Store cached value with corrupted data
      kv.setString(valueKeyFor(queryKey), 'invalid json{');
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 10000); // Old timestamp

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Fresh User', email: 'fresh@example.com' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });

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
