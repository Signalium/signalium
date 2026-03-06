/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t, getShapeKey, ValidatorDef } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { Query, getQuery, queryKeyForClass } from '../query.js';
import { hashValue } from 'signalium/utils';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { valueKeyFor, refCountKeyFor, refIdsKeyFor, updatedAtKeyFor } from '../stores/shared.js';
import { QueryResult } from 'src/types.js';
import { DiscriminatedReactivePromise } from 'signalium';

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

/**
 * Compute a query key from a Query class without needing the class to be registered
 * via getQuery(). This mirrors the internal logic of getQueryDefinition + queryKeyFor.
 */
function computeQueryKey(QueryClass: new () => Query, params: unknown): number {
  const instance = new QueryClass();
  const { path, method, response } = instance as any;
  const id = `${method ?? 'GET'}:${path}`;

  let shapeKey: number;
  if (response instanceof ValidatorDef) {
    shapeKey = response.shapeKey;
  } else if (response instanceof Set) {
    shapeKey = hashValue(response);
  } else if (typeof response === 'object' && response !== null) {
    const shape = t.object(response);
    shapeKey = (shape as any).shapeKey;
  } else {
    shapeKey = hashValue(response);
  }

  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  return hashValue([id, shapeKey, params]);
}

// Helper to set up a query result in the store
function setQuery(kv: any, QueryClass: new () => Query, params: unknown, result: unknown, refIds?: Set<number>) {
  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  const queryKey = computeQueryKey(QueryClass, params);
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
        class GetItem extends Query {
          path = '/items/[id]';
          response = { id: t.number, name: t.string };
        }

        const relay = getQuery(GetItem, { id: '1' });
        // Watcher is automatically managed
        await relay;

        // Verify data is in document store
        const queryKey = queryKeyForClass(GetItem, { id: '1' });
        const cached = getDocument(kv, queryKey);

        expect(cached).toMatchObject({ id: 1, name: 'Test' });
      });
    });

    it('should load query results from cache', async () => {
      class GetItem extends Query {
        path = '/items/[id]';
        response = { id: t.number, name: t.string };
      }

      const queryKey = computeQueryKey(GetItem, { id: '1' });
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
        const relay = getQuery(GetItem, { id: '1' });
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value!).toMatchObject({ id: 1, name: 'Cached Data' });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toMatchObject({ id: 1, name: 'Cached Data' });
        expect(relay.value!).toMatchObject({ id: 1, name: 'Cached Data' });
        expect(relay.isPending).toBe(false);

        await sleep(20);

        expect(relay.value!).toMatchObject({ id: 1, name: 'Fresh Data' });
        expect(await relay).toMatchObject({ id: 1, name: 'Fresh Data' });
      });
    });

    it('should persist across QueryClient instances', async () => {
      mockFetch.get('/item', { id: 1, value: 'Persistent' });

      class GetItem extends Query {
        path = '/item';
        response = { id: t.number, value: t.string };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetItem);
        await relay;
      });

      expect(mockFetch.calls).toHaveLength(1);
      mockFetch.reset();

      // Create new client with same stores
      mockFetch.get('/item', { id: 1, value: 'New Data' }, { delay: 10 });
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const relay = getQuery(GetItem);
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value!).toMatchObject({ id: 1, value: 'Persistent' });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toMatchObject({ id: 1, value: 'Persistent' });
        expect(relay.value!).toMatchObject({ id: 1, value: 'Persistent' });
        expect(relay.isPending).toBe(false);

        await sleep(30);

        expect(relay.value!).toMatchObject({ id: 1, value: 'New Data' });
        expect(await relay).toMatchObject({ id: 1, value: 'New Data' });
      });
    });
  });

  describe('Entity Persistence', () => {
    it('should persist entities to document store', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetUser extends Query {
          path = '/users/[id]';
          response = { user: t.entity(User) };
        }

        const relay = getQuery(GetUser, { id: '1' });
        await relay;

        // Verify entity is persisted
        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const entityData = getDocument(kv, userKey);

        expect(entityData).toBeDefined();
        expect(entityData).toMatchObject({
          __typename: 'User',
          id: 1,
          name: 'Alice',
        });
      });
    });

    it('should load entities from persistence', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetDocument extends Query {
        path = '/document';
        response = { user: t.entity(User) };
      }

      // Pre-populate entity
      const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
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
      setQuery(kv, GetDocument, {}, queryResult, new Set([userKey]));

      // Query returns entity reference
      mockFetch.get(
        '/document',
        {
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        },
        { delay: 10 },
      );

      await testWithClient(client, async () => {
        const relay = getQuery(GetDocument);
        // Force a pull
        relay.value;
        await sleep();

        expect(relay.value!).toMatchObject({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });

        const result = await relay;

        // Immediate value should be the same as the cached value because we're
        // background refetching but have a value that is still valid.
        expect(result).toMatchObject({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });
        expect(relay.value!).toMatchObject({ user: { __typename: 'User', id: 1, name: 'Persisted User' } });
        expect(relay.isPending).toBe(false);

        await sleep(20);

        expect(result).toMatchObject({ user: { __typename: 'User', id: 1, name: 'Fresh User' } });
        expect(relay.value!).toMatchObject({ user: { __typename: 'User', id: 1, name: 'Fresh User' } });
      });
    });
  });

  describe('Cache-loaded Entity Proxy Resolution', () => {
    it('should create proxy when setEntity merges into a preloaded entity record', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
      }

      // Pre-populate the entity in cache (simulating persistent storage preload)
      const userKey = hashValue('User:1');
      const preloadedUserData = {
        __typename: 'User',
        id: 1,
        name: 'Preloaded User',
      };
      setDocument(kv, userKey, preloadedUserData);

      // Set up query result that references the preloaded entity
      const queryResult = {
        user: { __entityRef: userKey },
      };
      setQuery(kv, GetUser, { id: '1' }, queryResult, new Set([userKey]));

      // Mock fetch returns updated data
      mockFetch.get(
        '/users/[id]',
        {
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        },
        { delay: 100 },
      );

      await testWithClient(client, async () => {
        const relay = getQuery(GetUser, { id: '1' });
        // Force a pull to load from cache
        relay.value;
        await sleep();

        // Access the user - this should work because setEntity creates a proxy
        // when merging into the preloaded entity record
        const result = relay.value;
        expect(result).toBeDefined();
        expect(result?.user).toBeDefined();

        // The proxy should resolve properly
        expect(result?.user.__typename).toBe('User');
        expect(result?.user.id).toBe(1);
        expect(result?.user.name).toBe('Preloaded User');
      });
    });

    it('should resolve __entityRef values when accessing nested entity properties via proxy', async () => {
      class Category extends Entity {
        __typename = t.typename('Category');
        id = t.id;
        name = t.string;
      }

      class Article extends Entity {
        __typename = t.typename('Article');
        id = t.id;
        title = t.string;
        category = t.entity(Category);
      }

      class GetArticle extends Query {
        path = '/articles/[id]';
        response = { article: t.entity(Article) };
      }

      // Pre-populate nested entity (Category) in cache
      const categoryKey = hashValue('Category:100');
      const categoryData = {
        __typename: 'Category',
        id: 100,
        name: 'Cached Category',
      };
      setDocument(kv, categoryKey, categoryData);

      // Pre-populate parent entity (Article) with __entityRef to nested entity
      const articleKey = hashValue('Article:1');
      const articleData = {
        __typename: 'Article',
        id: 1,
        title: 'Test Article',
        category: { __entityRef: categoryKey }, // This is how nested entities are stored in cache
      };
      setDocument(kv, articleKey, articleData, new Set([categoryKey]));

      // Set up query result
      const queryResult = {
        article: { __entityRef: articleKey },
      };
      setQuery(kv, GetArticle, { id: '1' }, queryResult, new Set([articleKey]));

      // Mock fetch returns data with delay so we can test cache-loaded data first
      mockFetch.get(
        '/articles/[id]',
        {
          article: {
            __typename: 'Article',
            id: 1,
            title: 'Fresh Article',
            category: {
              __typename: 'Category',
              id: 100,
              name: 'Fresh Category',
            },
          },
        },
        { delay: 100 },
      );

      await testWithClient(client, async () => {
        const relay = getQuery(GetArticle, { id: '1' });
        // Force a pull to load from cache
        relay.value;
        await sleep();

        const result = relay.value;
        expect(result).toBeDefined();
        expect(result?.article).toBeDefined();

        // Access the parent entity properties
        expect(result?.article.__typename).toBe('Article');
        expect(result?.article.id).toBe(1);
        expect(result?.article.title).toBe('Test Article');

        // Access nested entity via proxy - this should resolve the __entityRef
        // and return the hydrated entity proxy, not the raw __entityRef object
        const category = result?.article.category;
        expect(category).toBeDefined();
        expect((category as any).__typename).toBe('Category');
        expect((category as any).id).toBe(100);
        expect((category as any).name).toBe('Cached Category');
      });
    });

    it('should resolve deeply nested __entityRef values from cache', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        label = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        content = t.string;
        tag = t.entity(Tag);
      }

      class Author extends Entity {
        __typename = t.typename('Author');
        id = t.id;
        username = t.string;
        latestPost = t.entity(Post);
      }

      class GetAuthor extends Query {
        path = '/authors/[id]';
        response = { author: t.entity(Author) };
      }

      // Pre-populate deeply nested entity (Tag) in cache
      const tagKey = hashValue('Tag:999');
      setDocument(kv, tagKey, {
        __typename: 'Tag',
        id: 999,
        label: 'Cached Tag',
      });

      // Pre-populate middle entity (Post) with __entityRef to Tag
      const postKey = hashValue('Post:50');
      setDocument(
        kv,
        postKey,
        {
          __typename: 'Post',
          id: 50,
          content: 'Cached Post Content',
          tag: { __entityRef: tagKey },
        },
        new Set([tagKey]),
      );

      // Pre-populate parent entity (Author) with __entityRef to Post
      const authorKey = hashValue('Author:10');
      setDocument(
        kv,
        authorKey,
        {
          __typename: 'Author',
          id: 10,
          username: 'cached_author',
          latestPost: { __entityRef: postKey },
        },
        new Set([postKey]),
      );

      // Set up query result
      setQuery(kv, GetAuthor, { id: '10' }, { author: { __entityRef: authorKey } }, new Set([authorKey]));

      // Mock fetch with delay
      mockFetch.get(
        '/authors/[id]',
        {
          author: {
            __typename: 'Author',
            id: 10,
            username: 'fresh_author',
            latestPost: {
              __typename: 'Post',
              id: 50,
              content: 'Fresh Post',
              tag: { __typename: 'Tag', id: 999, label: 'Fresh Tag' },
            },
          },
        },
        { delay: 100 },
      );

      await testWithClient(client, async () => {
        const relay = getQuery(GetAuthor, { id: '10' });
        relay.value;
        await sleep();

        const result = relay.value;
        expect(result?.author).toBeDefined();

        // Verify Author loaded from cache
        expect(result?.author.username).toBe('cached_author');

        // Verify nested Post loaded from cache with __entityRef resolution
        const post = result?.author.latestPost;
        expect(post).toBeDefined();
        expect((post as any).content).toBe('Cached Post Content');

        // Verify deeply nested Tag loaded from cache with __entityRef resolution
        const tag = (post as any).tag;
        expect(tag).toBeDefined();
        expect(tag!.label).toBe('Cached Tag');
      });
    });

    it('should handle array of entities with __entityRef from cache', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        value = t.string;
      }

      class Container extends Entity {
        __typename = t.typename('Container');
        id = t.id;
        items = t.array(t.entity(Item));
      }

      class GetContainer extends Query {
        path = '/containers/[id]';
        response = { container: t.entity(Container) };
      }

      // Pre-populate array items in cache
      const item1Key = hashValue('Item:1');
      const item2Key = hashValue('Item:2');
      const item3Key = hashValue('Item:3');

      setDocument(kv, item1Key, { __typename: 'Item', id: 1, value: 'Cached Item 1' });
      setDocument(kv, item2Key, { __typename: 'Item', id: 2, value: 'Cached Item 2' });
      setDocument(kv, item3Key, { __typename: 'Item', id: 3, value: 'Cached Item 3' });

      // Pre-populate container with array of __entityRef
      const containerKey = hashValue('Container:100');
      setDocument(
        kv,
        containerKey,
        {
          __typename: 'Container',
          id: 100,
          items: [{ __entityRef: item1Key }, { __entityRef: item2Key }, { __entityRef: item3Key }],
        },
        new Set([item1Key, item2Key, item3Key]),
      );

      // Set up query result
      setQuery(kv, GetContainer, { id: '100' }, { container: { __entityRef: containerKey } }, new Set([containerKey]));

      mockFetch.get('/containers/[id]', { container: { __typename: 'Container', id: 100, items: [] } }, { delay: 100 });

      await testWithClient(client, async () => {
        const relay = getQuery(GetContainer, { id: '100' });
        relay.value;
        await sleep();

        const result = relay.value;
        expect(result?.container).toBeDefined();
        expect(result?.container.items).toHaveLength(3);

        // Each item in the array should be properly resolved from __entityRef
        expect((result?.container.items as any)[0].value).toBe('Cached Item 1');
        expect((result?.container.items as any)[1].value).toBe('Cached Item 2');
        expect((result?.container.items as any)[2].value).toBe('Cached Item 3');
      });
    });
  });

  describe('Reference Counting', () => {
    it('should increment ref count when entity is referenced', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        favoritePost = t.entity(Post);
      }

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
      }

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
        const relay = getQuery(GetUser, { id: '1' });
        await relay;

        // Check reference count
        const postKey = hashValue(['Post:1', getShapeKey(t.entity(Post))]);
        const refCount = await kv.getNumber(refCountKeyFor(postKey));

        expect(refCount).toBe(1);
      });
    });

    it('should handle multiple references to same entity', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/user/profile', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/user/details', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetUser1 extends Query {
          path = '/user/profile';
          response = { user: t.entity(User) };
        }

        class GetUser2 extends Query {
          path = '/user/details';
          response = { user: t.entity(User) };
        }

        const relay1 = getQuery(GetUser1);
        await relay1;

        const relay2 = getQuery(GetUser2);
        await relay2;

        // Entity should have references from queries
        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const refCount = await kv.getNumber(refCountKeyFor(userKey));

        expect(refCount).toBe(2);
      });
    });
  });

  describe('Document Store Operations', () => {
    it('should store query results with entity references', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetUser extends Query {
          path = '/users/[id]';
          response = { user: t.entity(User) };
        }

        const relay = getQuery(GetUser, { id: '1' });
        await relay;

        // Check that query and entity are stored
        const queryKey = queryKeyForClass(GetUser, { id: '1' });
        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);

        const queryValue = getDocument(kv, queryKey);
        expect(queryValue).toBeDefined();

        const entityValue = getDocument(kv, userKey);
        expect(entityValue).toMatchObject({
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
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        favoritePost = t.entity(Post);
      }

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
      }

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
        const relay = getQuery(GetUser, { id: '1' });
        await relay;

        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const postKey = hashValue(['Post:42', getShapeKey(t.entity(Post))]);

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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      // Set up a query cache with maxCount of 2
      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
        cache = { maxCount: 2 };
      }

      mockFetch.get('/users/1', { user: { __typename: 'User', id: 1, name: 'User 1' } });
      mockFetch.get('/users/2', { user: { __typename: 'User', id: 2, name: 'User 2' } });
      mockFetch.get('/users/3', { user: { __typename: 'User', id: 3, name: 'User 3' } });

      await testWithClient(client, async () => {
        // Fetch 3 users, the third should evict the first
        const relay1 = getQuery(GetUser, { id: '1' });
        await relay1;

        const relay2 = getQuery(GetUser, { id: '2' });
        await relay2;

        const query1Key = queryKeyForClass(GetUser, { id: '1' });
        const query2Key = queryKeyForClass(GetUser, { id: '2' });
        const query3Key = queryKeyForClass(GetUser, { id: '3' });

        const user1Key = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const user2Key = hashValue(['User:2', getShapeKey(t.entity(User))]);
        const user3Key = hashValue(['User:3', getShapeKey(t.entity(User))]);

        // Query 1 and 2 should exist
        expect(getDocument(kv, query1Key)).toBeDefined();
        expect(getDocument(kv, query2Key)).toBeDefined();

        // User 1 and 2 should exist
        expect(getDocument(kv, user1Key)).toBeDefined();
        expect(getDocument(kv, user2Key)).toBeDefined();

        // Fetch user 3, should evict user 1's query
        const relay3 = getQuery(GetUser, { id: '3' });
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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetProfile extends Query {
        path = '/user/profile/[id]';
        response = { user: t.entity(User) };
        cache = { maxCount: 1 };
      }

      class GetDetails extends Query {
        path = '/user/details/[id]';
        response = { user: t.entity(User) };
      }

      mockFetch.get('/user/profile/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/user/details/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        // Both queries reference the same user
        const relay1 = getQuery(GetProfile, { id: '1' });
        await relay1;

        const relay2 = getQuery(GetDetails, { id: '1' });
        await relay2;

        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);

        // User should have ref count of 2
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(2);

        // Force eviction of first query by making another profile request
        mockFetch.get('/user/profile/2', {
          user: { __typename: 'User', id: 2, name: 'Bob' },
        });

        const relay3 = getQuery(GetProfile, { id: '2' });
        await relay3;

        // Original user should still exist (referenced by details query)
        expect(getDocument(kv, userKey)).toBeDefined();
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(1);
      });
    });

    it('should handle deep cascade deletion through nested entities', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        tag = t.entity(Tag);
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        post = t.entity(Post);
      }

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

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
        cache = { maxCount: 1 };
      }

      await testWithClient(client, async () => {
        const relay1 = getQuery(GetUser, { id: '1' });
        await relay1;

        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const postKey = hashValue(['Post:10', getShapeKey(t.entity(Post))]);
        const tagKey = hashValue(['Tag:100', getShapeKey(t.entity(Tag))]);

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

        const relay2 = getQuery(GetUser, { id: '2' });
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
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        favoritePost = t.entity(Post);
      }

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
      }

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

      let relay: DiscriminatedReactivePromise<QueryResult<GetUser>>;

      let post10Key: number;

      await testWithClient(client, async () => {
        relay = getQuery(GetUser, { id: '1' });
        await relay;

        post10Key = hashValue(['Post:10', getShapeKey(t.entity(Post))]);

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
      });

      const result = await relay!.value!.__refetch();

      await testWithClient(client, async () => {
        const post20Key = hashValue(['Post:20', getShapeKey(t.entity(Post))]);

        expect(result).toMatchObject({
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
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      // Response with same post referenced multiple times
      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: 1, title: 'Post 1' },
          { __typename: 'Post', id: 1, title: 'Post 1' }, // Same post again
          { __typename: 'Post', id: 1, title: 'Post 1' }, // And again
        ],
      });

      await testWithClient(client, async () => {
        class GetPosts extends Query {
          path = '/posts';
          response = { posts: t.array(t.entity(Post)) };
        }

        const relay = getQuery(GetPosts);
        const result = await relay;

        expect(result.posts.length).toEqual(3);

        const postKey = hashValue(['Post:1', getShapeKey(t.entity(Post))]);
        const queryKey = queryKeyForClass(GetPosts, undefined);

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
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        post = t.entity(Post);
      }

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: { __typename: 'Post', id: 10, title: 'Post' },
        },
      });

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
        cache = { maxCount: 1 };
      }

      await testWithClient(client, async () => {
        const relay1 = getQuery(GetUser, { id: '1' });
        await relay1;

        const queryKey = queryKeyForClass(GetUser, { id: '1' });

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

        const relay2 = getQuery(GetUser, { id: '2' });
        await relay2;

        // All query keys should be cleaned up
        expect(await kv.getString(valueKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getNumber(updatedAtKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getBuffer(refIdsKeyFor(queryKey))).toBeUndefined();
        expect(await kv.getNumber(refCountKeyFor(queryKey))).toBeUndefined();
      });
    });

    it('should clean up all entity storage keys when cascade deleted', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        post = t.entity(Post);
      }

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          post: { __typename: 'Post', id: 10, title: 'Post' },
        },
      });

      class GetUser extends Query {
        path = '/users/[id]';
        response = { user: t.entity(User) };
        cache = { maxCount: 1 };
      }

      await testWithClient(client, async () => {
        const relay1 = getQuery(GetUser, { id: '1' });
        await relay1;

        const userKey = hashValue(['User:1', getShapeKey(t.entity(User))]);
        const postKey = hashValue(['Post:10', getShapeKey(t.entity(Post))]);

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

        const relay2 = getQuery(GetUser, { id: '2' });
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
      class PositionV1 extends Entity {
        __typename = t.typename('Position');
        id = t.id;
        size = t.number;
      }

      mockFetch.get('/positions/[id]', {
        position: { __typename: 'Position', id: 123, size: 100 },
      });

      await testWithClient(client, async () => {
        class GetPositionV1 extends Query {
          path = '/positions/[id]';
          response = { position: t.entity(PositionV1) };
        }

        // Fetch with V1 schema
        const relay1 = getQuery(GetPositionV1, { id: '123' });
        const result1 = await relay1;

        expect(result1.position.size).toBe(100);
      });

      // Second schema version - Position WITH predictionOutcome (new required field)
      class Outcome extends Entity {
        __typename = t.typename('Outcome');
        id = t.id;
        value = t.string;
      }

      class PositionV2 extends Entity {
        __typename = t.typename('Position');
        id = t.id;
        size = t.number;
        predictionOutcome = t.entity(Outcome);
      }

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
        class GetPositionV2 extends Query {
          path = '/positions/[id]';
          response = { position: t.entity(PositionV2) };
        }

        // Fetch with V2 schema - this should NOT throw a validation error
        const relay2 = getQuery(GetPositionV2, { id: '123' });
        const result2 = await relay2;

        // Should have the new data with predictionOutcome
        expect(result2.position.size).toBe(200);
        expect((result2.position.predictionOutcome as any).value).toBe('win');
      });

      client2.destroy();
    });

    it('should store entities with different shapes separately', async () => {
      class UserV1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class UserV2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string; // New field in V2
      }

      // Fetch user with V1 schema
      mockFetch.get('/users/v1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetUserV1 extends Query {
          path = '/users/v1';
          response = { user: t.entity(UserV1) };
        }

        const relay1 = getQuery(GetUserV1);
        await relay1;
      });

      // Fetch same user with V2 schema (different endpoint to avoid query cache)
      mockFetch.get('/users/v2', {
        user: { __typename: 'User', id: 1, name: 'Alice', email: 'alice@example.com' },
      });

      await testWithClient(client, async () => {
        class GetUserV2 extends Query {
          path = '/users/v2';
          response = { user: t.entity(UserV2) };
        }

        const relay2 = getQuery(GetUserV2);
        await relay2;
      });

      // Both entities should exist in the store with different keys
      const keyV1 = hashValue(['User:1', getShapeKey(t.entity(UserV1))]);
      const keyV2 = hashValue(['User:1', getShapeKey(t.entity(UserV2))]);

      expect(keyV1).not.toBe(keyV2);

      const entityV1 = getDocument(kv, keyV1);
      const entityV2 = getDocument(kv, keyV2);

      expect(entityV1).toBeDefined();
      expect(entityV2).toBeDefined();
      expect((entityV1 as any).name).toBe('Alice');
      expect((entityV2 as any).name).toBe('Alice');
      expect((entityV2 as any).email).toBe('alice@example.com');
      // V1 entity should not have email field
      expect((entityV1 as any).email).toBeUndefined();
    });
  });
});
