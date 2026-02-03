/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query, queryKeyForFn } from '../query.js';
import { hashValue } from 'signalium/utils';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { valueKeyFor, refCountKeyFor, refIdsKeyFor, updatedAtKeyFor } from '../stores/shared.js';

/**
 * Caching and Persistence Tests
 *
 * Tests query caching, document store persistence, reference counting,
 * cascade deletion, and LRU cache management.
 */

// Helper to simulate old store.set() behavior for testing
function setDocument(kv: any, key: number, value: unknown, refIds?: Set<number>) {
  kv.setString(valueKeyFor(key), JSON.stringify(value));

  const prevRefIds = kv.getBuffer(refIdsKeyFor(key));

  if (refIds === undefined || refIds.size === 0) {
    kv.delete(refIdsKeyFor(key));

    // Decrement all previous refs
    if (prevRefIds) {
      for (const refId of prevRefIds) {
        if (refId === 0) continue;
        const refCountKey = refCountKeyFor(refId);
        const currentCount = kv.getNumber(refCountKey);
        if (currentCount === undefined) continue;

        const newCount = currentCount - 1;
        if (newCount === 0) {
          kv.delete(refCountKey);
        } else {
          kv.setNumber(refCountKey, newCount);
        }
      }
    }
  } else {
    // Convert to array for storage
    const newRefArray = new Uint32Array([...refIds]);
    kv.setBuffer(refIdsKeyFor(key), newRefArray);

    // Build sets for comparison
    const prevRefSet = new Set(prevRefIds || []);
    const newRefSet = new Set(refIds);

    // Decrement refs that are no longer present
    if (prevRefIds) {
      for (const refId of prevRefIds) {
        if (refId === 0) continue;
        if (!newRefSet.has(refId)) {
          const refCountKey = refCountKeyFor(refId);
          const currentCount = kv.getNumber(refCountKey);
          if (currentCount === undefined) continue;

          const newCount = currentCount - 1;
          if (newCount === 0) {
            kv.delete(refCountKey);
          } else {
            kv.setNumber(refCountKey, newCount);
          }
        }
      }
    }

    // Increment refs that are new
    for (const refId of refIds) {
      if (!prevRefSet.has(refId)) {
        const refCountKey = refCountKeyFor(refId);
        const currentCount = kv.getNumber(refCountKey) ?? 0;
        kv.setNumber(refCountKey, currentCount + 1);
      }
    }
  }
}

// Helper to simulate old store.get() behavior
function getDocument(kv: any, key: number): unknown | undefined {
  const value = kv.getString(valueKeyFor(key));
  return value ? JSON.parse(value) : undefined;
}

// Helper to simulate old store.delete() behavior
function deleteDocument(kv: any, key: number) {
  const refIds = kv.getBuffer(refIdsKeyFor(key));

  kv.delete(valueKeyFor(key));
  kv.delete(refIdsKeyFor(key));
  kv.delete(refCountKeyFor(key));

  // Decrement ref counts and cascade delete if needed
  if (refIds) {
    for (const refId of refIds) {
      if (refId === 0) continue;

      const refCountKey = refCountKeyFor(refId);
      const currentCount = kv.getNumber(refCountKey);

      if (currentCount === undefined) continue;

      const newCount = currentCount - 1;

      if (newCount === 0) {
        // Cascade delete
        deleteDocument(kv, refId);
      } else {
        kv.setNumber(refCountKey, newCount);
      }
    }
  }
}

// Helper to set up a query result in the store
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function setQuery(kv: any, queryFn: Function, params: unknown, result: unknown, refIds?: Set<number>) {
  if (typeof params === 'object' && params !== null && Object.keys(params).length === 0) {
    params = undefined;
  }

  const queryKey = queryKeyForFn(queryFn, params);
  setDocument(kv, queryKey, result, refIds);
  kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
}

describe('Caching and Persistence', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    client?.destroy();
    kv = new MemoryPersistentStore();
    const queryStore = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(queryStore, { fetch: mockFetch as any });
    store = queryStore;
  });

  describe('Query Result Caching', () => {
    it('should cache query results in document store', async () => {
      mockFetch.get('/items/[id]', { id: 1, name: 'Test' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/items/[id]',
          response: { id: t.number, name: t.string },
        }));

        const relay = getItem({ id: '1' });
        // Watcher is automatically managed
        await relay;

        // Verify data is in document store
        const queryKey = queryKeyForFn(getItem, { id: '1' });
        const cached = getDocument(kv, queryKey);

        expect(cached).toEqual({ id: 1, name: 'Test' });
      });
    });

    it('should load query results from cache', async () => {
      const getItem = query(() => ({
        path: '/items/[id]',
        response: { id: t.number, name: t.string },
      }));

      const queryKey = queryKeyForFn(getItem, { id: '1' });
      const cachedData = { id: 1, name: 'Cached Data' };

      // Pre-populate cache
      setDocument(kv, queryKey, cachedData);
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      mockFetch.get(
        '/items/[id]',
        { id: 1, name: 'Fresh Data' },
        {
          delay: 10,
        },
      );

      await testWithClient(client, async () => {
        const relay = getItem({ id: '1' });
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value).toEqual({ id: 1, name: 'Cached Data' });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toEqual({ id: 1, name: 'Cached Data' });
        expect(relay.value).toEqual({ id: 1, name: 'Cached Data' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRefetching).toBe(true);

        await sleep(20);

        expect(relay.isRefetching).toBe(false);
        expect(relay.value).toEqual({ id: 1, name: 'Fresh Data' });
        expect(await relay).toEqual({ id: 1, name: 'Fresh Data' });
      });
    });

    it('should persist across QueryClient instances', async () => {
      mockFetch.get('/item', { id: 1, value: 'Persistent' });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, value: t.string },
      }));

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      expect(mockFetch.calls).toHaveLength(1);
      mockFetch.reset();

      // Create new client with same stores
      mockFetch.get('/item', { id: 1, value: 'New Data' }, { delay: 10 });
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const relay = getItem();
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value).toEqual({ id: 1, value: 'Persistent' });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toEqual({ id: 1, value: 'Persistent' });
        expect(relay.value).toEqual({ id: 1, value: 'Persistent' });
        expect(relay.isPending).toBe(false);
        expect(relay.isRefetching).toBe(true);

        await sleep(30);

        expect(relay.value).toEqual({ id: 1, value: 'New Data' });
        expect(await relay).toEqual({ id: 1, value: 'New Data' });
      });
    });
  });

  describe('Entity Persistence', () => {
    it('should persist entities to document store', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        // Verify entity is persisted
        const userKey = hashValue(['User:1', User.shapeKey]);
        const entityData = getDocument(kv, userKey);

        expect(entityData).toBeDefined();
        expect(entityData).toEqual({
          __typename: 'User',
          id: 1,
          name: 'Alice',
        });
      });
    });

    it('should load entities from persistence', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getDocument = query(() => ({
        path: '/document',
        response: { user: User },
      }));

      // Pre-populate entity
      const userKey = hashValue(['User:1', User.shapeKey]);
      const userData = {
        __typename: 'User',
        id: 1,
        name: 'Persisted User',
      };

      setDocument(kv, userKey, userData);

      // Set up the query result with reference to the user
      const queryResult = {
        user: { __entityRef: userKey },
      };
      setQuery(kv, getDocument, {}, queryResult, new Set([userKey]));

      // Query returns entity reference
      mockFetch.get(
        '/document',
        {
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        },
        { delay: 10 },
      );

      await testWithClient(client, async () => {
        const relay = getDocument();
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value).toEqual({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toEqual({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });
        expect(relay.value).toEqual({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });
        expect(relay.isPending).toBe(false);
        expect(relay.isRefetching).toBe(true);

        await sleep(20);

        expect(result).toEqual({ user: { __typename: 'User', id: 1, name: 'Fresh User' } });
        expect(relay.value).toEqual({ user: { __typename: 'User', id: 1, name: 'Fresh User' } });
      });
    });
  });

  describe('Reference Counting', () => {
    it('should increment ref count when entity is referenced', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        favoritePost: Post,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          favoritePost: {
            __typename: 'Post',
            id: 1,
            title: 'Favorite Post',
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        // Check reference count
        const postKey = hashValue(['Post:1', Post.shapeKey]);
        const refCount = await kv.getNumber(refCountKeyFor(postKey));

        expect(refCount).toBe(1);
      });
    });

    it('should handle multiple references to same entity', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user/profile', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/user/details', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser1 = query(() => ({
          path: '/user/profile',
          response: { user: User },
        }));

        const getUser2 = query(() => ({
          path: '/user/details',
          response: { user: User },
        }));

        const relay1 = getUser1();
        await relay1;

        const relay2 = getUser2();
        await relay2;

        // Entity should have references from queries
        const userKey = hashValue(['User:1', User.shapeKey]);
        const refCount = await kv.getNumber(refCountKeyFor(userKey));

        expect(refCount).toBe(2);
      });
    });
  });

  describe('Document Store Operations', () => {
    it('should store query results with entity references', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        // Check that query and entity are stored
        const queryKey = queryKeyForFn(getUser, { id: '1' });
        const userKey = hashValue(['User:1', User.shapeKey]);

        const queryValue = getDocument(kv, queryKey);
        expect(queryValue).toBeDefined();

        const entityValue = getDocument(kv, userKey);
        expect(entityValue).toEqual({
          __typename: 'User',
          id: 1,
          name: 'Alice',
        });

        // Check that query references the entity
        const refs = await kv.getBuffer(refIdsKeyFor(queryKey));
        expect(refs).toBeDefined();
        expect(Array.from(refs!)).toContain(userKey);
      });
    });

    it('should store nested entity references correctly', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        favoritePost: Post,
      }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          favoritePost: {
            __typename: 'Post',
            id: 42,
            title: 'My Post',
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const userKey = hashValue(['User:1', User.shapeKey]);
        const postKey = hashValue(['Post:42', Post.shapeKey]);

        // User should reference Post
        const userRefs = await kv.getBuffer(refIdsKeyFor(userKey));
        expect(userRefs).toBeDefined();
        expect(Array.from(userRefs!)).toContain(postKey);

        // Post should have a reference count of 1
        expect(await kv.getNumber(refCountKeyFor(postKey))).toBe(1);
      });
    });
  });

  describe('Cascade Deletion', () => {
    it('should cascade delete entities when query is evicted from LRU', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      // Set up a query cache with maxCount of 2
      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: { maxCount: 2 },
      }));

      mockFetch.get('/users/1', { user: { __typename: 'User', id: 1, name: 'User 1' } });
      mockFetch.get('/users/2', { user: { __typename: 'User', id: 2, name: 'User 2' } });
      mockFetch.get('/users/3', { user: { __typename: 'User', id: 3, name: 'User 3' } });

      await testWithClient(client, async () => {
        // Fetch 3 users, the third should evict the first
        const relay1 = getUser({ id: '1' });
        await relay1;

        const relay2 = getUser({ id: '2' });
        await relay2;

        const query1Key = queryKeyForFn(getUser, { id: '1' });
        const query2Key = queryKeyForFn(getUser, { id: '2' });
        const query3Key = queryKeyForFn(getUser, { id: '3' });

        const user1Key = hashValue(['User:1', User.shapeKey]);
        const user2Key = hashValue(['User:2', User.shapeKey]);
        const user3Key = hashValue(['User:3', User.shapeKey]);

        // Query 1 and 2 should exist
        expect(getDocument(kv, query1Key)).toBeDefined();
        expect(getDocument(kv, query2Key)).toBeDefined();

        // User 1 and 2 should exist
        expect(getDocument(kv, user1Key)).toBeDefined();
        expect(getDocument(kv, user2Key)).toBeDefined();

        // Fetch user 3, should evict user 1's query
        const relay3 = getUser({ id: '3' });
        await relay3;

        // Query 1 should be evicted
        expect(getDocument(kv, query1Key)).toBeUndefined();
        expect(getDocument(kv, query2Key)).toBeDefined();
        expect(getDocument(kv, query3Key)).toBeDefined();

        // User 1 should be cascade deleted
        expect(getDocument(kv, user1Key)).toBeUndefined();
        expect(getDocument(kv, user2Key)).toBeDefined();
        expect(getDocument(kv, user3Key)).toBeDefined();
      });
    });

    it('should NOT delete entity if still referenced by another query', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getProfile = query(() => ({
        path: '/user/profile/[id]',
        response: { user: User },
        cache: { maxCount: 1 },
      }));

      const getDetails = query(() => ({
        path: '/user/details/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/profile/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/user/details/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        // Both queries reference the same user
        const relay1 = getProfile({ id: '1' });
        await relay1;

        const relay2 = getDetails({ id: '1' });
        await relay2;

        const userKey = hashValue(['User:1', User.shapeKey]);

        // User should have ref count of 2
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(2);

        // Force eviction of first query by making another profile request
        mockFetch.get('/user/profile/2', {
          user: { __typename: 'User', id: 2, name: 'Bob' },
        });

        const relay3 = getProfile({ id: '2' });
        await relay3;

        // Original user should still exist (referenced by details query)
        expect(getDocument(kv, userKey)).toBeDefined();
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(1);
      });
    });

    it('should handle deep cascade deletion through nested entities', async () => {
      const Tag = entity(() => ({
        __typename: t.typename('Tag'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        tag: Tag,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        post: Post,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: {
            __typename: 'Post',
            id: 10,
            title: 'My Post',
            tag: {
              __typename: 'Tag',
              id: 100,
              name: 'Tech',
            },
          },
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: { maxCount: 1 },
      }));

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '1' });
        await relay1;

        const userKey = hashValue(['User:1', User.shapeKey]);
        const postKey = hashValue(['Post:10', Post.shapeKey]);
        const tagKey = hashValue(['Tag:100', Tag.shapeKey]);

        // All entities should exist
        expect(getDocument(kv, userKey)).toBeDefined();
        expect(getDocument(kv, postKey)).toBeDefined();
        expect(getDocument(kv, tagKey)).toBeDefined();

        // Fetch a different user to evict the first
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 2,
            name: 'Bob',
            post: {
              __typename: 'Post',
              id: 20,
              title: 'Other Post',
              tag: {
                __typename: 'Tag',
                id: 200,
                name: 'Other',
              },
            },
          },
        });

        const relay2 = getUser({ id: '2' });
        await relay2;

        // All original entities should be cascade deleted
        expect(getDocument(kv, userKey)).toBeUndefined();
        expect(getDocument(kv, postKey)).toBeUndefined();
        expect(getDocument(kv, tagKey)).toBeUndefined();
      });
    });
  });

  describe('Reference Updates', () => {
    it('should update references when query result changes', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        favoritePost: Post,
      }));

      // First response with post 1
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          favoritePost: {
            __typename: 'Post',
            id: 10,
            title: 'Post 10',
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        const post10Key = hashValue(['Post:10', Post.shapeKey]);

        // Post 10 should have 1 reference
        expect(await kv.getNumber(refCountKeyFor(post10Key))).toBe(1);

        // Update response to reference a different post
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            favoritePost: {
              __typename: 'Post',
              id: 20,
              title: 'Post 20',
            },
          },
        });

        const result = await relay.refetch();

        const post20Key = hashValue(['Post:20', Post.shapeKey]);

        expect(result).toEqual({
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            favoritePost: { __typename: 'Post', id: 20, title: 'Post 20' },
          },
        });

        // Post 10 should have no refs (and be deleted)
        expect(await kv.getNumber(refCountKeyFor(post10Key))).toBeUndefined();
        expect(getDocument(kv, post10Key)).toBeUndefined();

        // Post 20 should have 1 reference
        expect(await kv.getNumber(refCountKeyFor(post20Key))).toBe(1);
      });
    });

    it('should deduplicate entity references in arrays', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      // Response with same post referenced multiple times
      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: 1, title: 'Post 1' },
          { __typename: 'Post', id: 1, title: 'Post 1' }, // Same post again
          { __typename: 'Post', id: 1, title: 'Post 1' }, // And again
        ],
      });

      await testWithClient(client, async () => {
        const getPosts = query(() => ({
          path: '/posts',
          response: { posts: t.array(Post) },
        }));

        const relay = getPosts();
        const result = await relay;

        expect(result.posts.length).toEqual(3);

        const postKey = hashValue(['Post:1', Post.shapeKey]);
        const queryKey = queryKeyForFn(getPosts, undefined);

        // Query should reference post 1
        const refs = await kv.getBuffer(refIdsKeyFor(queryKey));
        expect(refs).toBeDefined();
        expect(Array.from(refs!).filter(id => id === postKey).length).toBe(1);

        // Post should have ref count of 1 (deduplicated)
        expect(await kv.getNumber(refCountKeyFor(postKey))).toBe(1);
      });
    });
  });

  describe('Storage Cleanup', () => {
    it('should clean up all query storage keys when evicted from LRU', async () => {
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

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: { __typename: 'Post', id: 10, title: 'Post' },
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: { maxCount: 1 },
      }));

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '1' });
        await relay1;

        const queryKey = queryKeyForFn(getUser, { id: '1' });

        // Verify all keys exist for the query
        expect(await kv.getString(valueKeyFor(queryKey))).toBeDefined();
        expect(await kv.getNumber(updatedAtKeyFor(queryKey))).toBeDefined();
        expect(await kv.getBuffer(refIdsKeyFor(queryKey))).toBeDefined();

        // Fetch different user to evict first query
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 2,
            name: 'Bob',
            post: { __typename: 'Post', id: 20, title: 'Other' },
          },
        });

        const relay2 = getUser({ id: '2' });
        await relay2;

        // All query keys should be cleaned up
        expect(await kv.getString(valueKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getNumber(updatedAtKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getBuffer(refIdsKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getNumber(refCountKeyFor(queryKey))).toBeUndefined();
      });
    });

    it('should clean up all entity storage keys when cascade deleted', async () => {
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

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: { __typename: 'Post', id: 10, title: 'Post' },
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
        cache: { maxCount: 1 },
      }));

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '1' });
        await relay1;

        const userKey = hashValue(['User:1', User.shapeKey]);
        const postKey = hashValue(['Post:10', Post.shapeKey]);

        // Verify all keys exist for entities
        expect(await kv.getString(valueKeyFor(userKey))).toBeDefined();
        expect(await kv.getString(valueKeyFor(postKey))).toBeDefined();
        expect(await kv.getBuffer(refIdsKeyFor(userKey))).toBeDefined();
        expect(await kv.getNumber(refCountKeyFor(postKey))).toBe(1);

        // Fetch different user to evict first query and cascade delete entities
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 2,
            name: 'Bob',
            post: { __typename: 'Post', id: 20, title: 'Other' },
          },
        });

        const relay2 = getUser({ id: '2' });
        await relay2;

        // All entity keys should be cleaned up
        expect(await kv.getString(valueKeyFor(userKey))).toBeUndefined();
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBeUndefined();
        expect(await kv.getBuffer(refIdsKeyFor(userKey))).toBeUndefined();

        expect(await kv.getString(valueKeyFor(postKey))).toBeUndefined();
        expect(await kv.getNumber(refCountKeyFor(postKey))).toBeUndefined();
        expect(await kv.getBuffer(refIdsKeyFor(postKey))).toBeUndefined();
      });
    });
  });

  describe('Schema Evolution', () => {
    it('should handle schema changes without validation errors', async () => {
      // This test verifies the fix for the bug where entity cache keys didn't include shapeKey,
      // causing stale entity validation errors after schema changes.

      // First schema version - Position without predictionOutcome
      const PositionV1 = entity(() => ({
        __typename: t.typename('Position'),
        id: t.id,
        size: t.number,
      }));

      mockFetch.get('/positions/[id]', {
        position: { __typename: 'Position', id: 123, size: 100 },
      });

      await testWithClient(client, async () => {
        const getPositionV1 = query(() => ({
          path: '/positions/[id]',
          response: { position: PositionV1 },
        }));

        // Fetch with V1 schema
        const relay1 = getPositionV1({ id: '123' });
        const result1 = await relay1;

        expect(result1.position.size).toBe(100);
      });

      // Second schema version - Position WITH predictionOutcome (new required field)
      const Outcome = entity(() => ({
        __typename: t.typename('Outcome'),
        id: t.id,
        value: t.string,
      }));

      const PositionV2 = entity(() => ({
        __typename: t.typename('Position'),
        id: t.id,
        size: t.number,
        predictionOutcome: Outcome,
      }));

      // Update mock to return data with the new field
      mockFetch.get('/positions/[id]', {
        position: {
          __typename: 'Position',
          id: 123,
          size: 200,
          predictionOutcome: { __typename: 'Outcome', id: 1, value: 'win' },
        },
      });

      // Create a new client to simulate a fresh session (but same persistent store)
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const getPositionV2 = query(() => ({
          path: '/positions/[id]',
          response: { position: PositionV2 },
        }));

        // Fetch with V2 schema - this should NOT throw a validation error
        // because the entity key now includes shapeKey, so V1 and V2 entities
        // are stored separately
        const relay2 = getPositionV2({ id: '123' });
        const result2 = await relay2;

        // Should have the new data with predictionOutcome
        expect(result2.position.size).toBe(200);
        expect(result2.position.predictionOutcome.value).toBe('win');
      });

      client2.destroy();
    });

    it('should store entities with different shapes separately', async () => {
      // Define two versions of the same entity with different shapes
      const UserV1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const UserV2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string, // New field in V2
      }));

      // The keys should be different because shapeKey is included
      const keyV1 = hashValue(['User:1', UserV1.shapeKey]);
      const keyV2 = hashValue(['User:1', UserV2.shapeKey]);

      expect(keyV1).not.toBe(keyV2);
      expect(UserV1.shapeKey).not.toBe(UserV2.shapeKey);
    });
  });
});
