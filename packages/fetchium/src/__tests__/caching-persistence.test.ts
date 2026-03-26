/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery, queryKeyForClass, getQueryDefinition } from '../query.js';
import { hashValue } from 'signalium/utils';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import {
  valueKeyFor,
  refCountKeyFor,
  refIdsKeyFor,
  updatedAtKeyFor,
  lastUsedKeyFor,
  cacheTimeKeyFor,
  queueKeyFor,
} from '../stores/shared.js';
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
 * via fetchQuery(). This mirrors the internal logic of getQueryDefinition + queryKeyFor.
 */
function computeQueryKey(QueryClass: new () => RESTQuery, params: unknown): number {
  const instance = new QueryClass();
  const { path, method } = instance as any;
  const id = `${method ?? 'GET'}:${path}`;

  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  return hashValue([id, params]);
}

/**
 * Compute the root entity key for a non-entity query result.
 * The root entity's typename is the query's statics.id string, and the key is
 * hashValue([typename, paramsId]) where paramsId = hashValue(extractedParams).
 */
function computeRootEntityKey(QueryClass: new () => RESTQuery, params: unknown): number {
  const def = getQueryDefinition(QueryClass);
  const id = def.statics.id;

  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  const paramsId = params !== undefined ? hashValue(params) : 0;
  return hashValue([id, paramsId]);
}

// Helper to set up a query result in the store
function setQuery(kv: any, QueryClass: new () => RESTQuery, params: unknown, result: unknown, refIds?: Set<number>) {
  if (typeof params === 'object' && params !== null && Object.keys(params as any).length === 0) {
    params = undefined;
  }

  const queryKey = queryKeyForClass(QueryClass, params);
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
        class GetItem extends RESTQuery {
          params = { id: t.id };
          path = `/items/${this.params.id}`;
          result = { id: t.number, name: t.string };
        }

        const relay = fetchQuery(GetItem, { id: '1' });
        // Watcher is automatically managed
        await relay;

        // Verify data is in document store
        const queryKey = queryKeyForClass(GetItem, { id: '1' });
        const cached = getDocument(kv, queryKey);
        const rootEntityKey = computeRootEntityKey(GetItem, { id: '1' });

        // Query value is now a ref to the root entity
        expect(cached).toMatchObject({ __entityRef: rootEntityKey });

        // Root entity data is stored separately
        const rootEntityData = getDocument(kv, rootEntityKey);
        expect(rootEntityData).toMatchObject({ id: 1, name: 'Test' });
      });
    });

    it('should load query results from cache', async () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryKey = queryKeyForClass(GetItem, { id: '1' });
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
        const relay = fetchQuery(GetItem, { id: '1' });
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

      class GetItem extends RESTQuery {
        path = '/item';
        result = { id: t.number, value: t.string };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItem);
        await relay;
      });

      expect(mockFetch.calls).toHaveLength(1);
      mockFetch.reset();

      // Create new client with same stores
      mockFetch.get('/item', { id: 1, value: 'New Data' }, { delay: 10 });
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const relay = fetchQuery(GetItem);
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
        class GetUser extends RESTQuery {
          params = { id: t.id };
          path = `/users/${this.params.id}`;
          result = { user: t.entity(User) };
        }

        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        // Verify entity is persisted
        const userKey = hashValue(['User', 1]);
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

      class GetDocument extends RESTQuery {
        path = '/document';
        result = { user: t.entity(User) };
      }

      // Pre-populate entity
      const userKey = hashValue(['User', 1]);
      const userData = {
        __typename: 'User',
        id: 1,
        name: 'Persisted User',
      };

      setDocument(kv, userKey, userData);

      // Set up the root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetDocument, {});
      const rootEntityData = {
        __queryId: rootEntityKey,
        user: { __entityRef: userKey },
      };
      setDocument(kv, rootEntityKey, rootEntityData, new Set([userKey]));

      // Set up the query result as a ref to the root entity
      setQuery(kv, GetDocument, {}, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

      // Query returns entity reference
      mockFetch.get(
        '/document',
        {
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        },
        { delay: 10 },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetDocument);
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

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      // Pre-populate the entity in cache (simulating persistent storage preload)
      const userKey = hashValue(['User', 1]);
      const preloadedUserData = {
        __typename: 'User',
        id: 1,
        name: 'Preloaded User',
      };
      setDocument(kv, userKey, preloadedUserData);

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetUser, { id: '1' });
      const rootEntityData = {
        __queryId: rootEntityKey,
        user: { __entityRef: userKey },
      };
      setDocument(kv, rootEntityKey, rootEntityData, new Set([userKey]));

      // Set up query result as a ref to the root entity
      setQuery(kv, GetUser, { id: '1' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

      // Mock fetch returns updated data
      mockFetch.get(
        '/users/[id]',
        {
          user: { __typename: 'User', id: 1, name: 'Fresh User' },
        },
        { delay: 100 },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
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

      class GetArticle extends RESTQuery {
        params = { id: t.id };
        path = `/articles/${this.params.id}`;
        result = { article: t.entity(Article) };
      }

      // Pre-populate nested entity (Category) in cache
      const categoryKey = hashValue(['Category', 100]);
      const categoryData = {
        __typename: 'Category',
        id: 100,
        name: 'Cached Category',
      };
      setDocument(kv, categoryKey, categoryData);

      // Pre-populate parent entity (Article) with __entityRef to nested entity
      const articleKey = hashValue(['Article', 1]);
      const articleData = {
        __typename: 'Article',
        id: 1,
        title: 'Test Article',
        category: { __entityRef: categoryKey }, // This is how nested entities are stored in cache
      };
      setDocument(kv, articleKey, articleData, new Set([categoryKey]));

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetArticle, { id: '1' });
      const rootEntityData = {
        __queryId: rootEntityKey,
        article: { __entityRef: articleKey },
      };
      setDocument(kv, rootEntityKey, rootEntityData, new Set([articleKey]));

      // Set up query result as a ref to the root entity
      setQuery(kv, GetArticle, { id: '1' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

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
        const relay = fetchQuery(GetArticle, { id: '1' });
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

      class GetAuthor extends RESTQuery {
        params = { id: t.id };
        path = `/authors/${this.params.id}`;
        result = { author: t.entity(Author) };
      }

      // Pre-populate deeply nested entity (Tag) in cache
      const tagKey = hashValue(['Tag', 999]);
      setDocument(kv, tagKey, {
        __typename: 'Tag',
        id: 999,
        label: 'Cached Tag',
      });

      // Pre-populate middle entity (Post) with __entityRef to Tag
      const postKey = hashValue(['Post', 50]);
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
      const authorKey = hashValue(['Author', 10]);
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

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetAuthor, { id: '10' });
      setDocument(
        kv,
        rootEntityKey,
        { __queryId: rootEntityKey, author: { __entityRef: authorKey } },
        new Set([authorKey]),
      );

      // Set up query result as a ref to the root entity
      setQuery(kv, GetAuthor, { id: '10' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

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
        const relay = fetchQuery(GetAuthor, { id: '10' });
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

      class GetContainer extends RESTQuery {
        params = { id: t.id };
        path = `/containers/${this.params.id}`;
        result = { container: t.entity(Container) };
      }

      // Pre-populate array items in cache
      const item1Key = hashValue(['Item', 1]);
      const item2Key = hashValue(['Item', 2]);
      const item3Key = hashValue(['Item', 3]);

      setDocument(kv, item1Key, { __typename: 'Item', id: 1, value: 'Cached Item 1' });
      setDocument(kv, item2Key, { __typename: 'Item', id: 2, value: 'Cached Item 2' });
      setDocument(kv, item3Key, { __typename: 'Item', id: 3, value: 'Cached Item 3' });

      // Pre-populate container with array of __entityRef
      const containerKey = hashValue(['Container', 100]);
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

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetContainer, { id: '100' });
      setDocument(
        kv,
        rootEntityKey,
        { __queryId: rootEntityKey, container: { __entityRef: containerKey } },
        new Set([containerKey]),
      );

      // Set up query result as a ref to the root entity
      setQuery(kv, GetContainer, { id: '100' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

      mockFetch.get('/containers/[id]', { container: { __typename: 'Container', id: 100, items: [] } }, { delay: 100 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetContainer, { id: '100' });
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

    it('should resolve array of entities with nested entities from cache', async () => {
      class Author extends Entity {
        __typename = t.typename('Author');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        author = t.entity(Author);
      }

      class Blog extends Entity {
        __typename = t.typename('Blog');
        id = t.id;
        posts = t.array(t.entity(Post));
      }

      class GetBlog extends RESTQuery {
        params = { id: t.id };
        path = `/blogs/${this.params.id}`;
        result = { blog: t.entity(Blog) };
      }

      // Pre-populate authors
      const author1Key = hashValue(['Author', 1]);
      const author2Key = hashValue(['Author', 2]);
      setDocument(kv, author1Key, { __typename: 'Author', id: 1, name: 'Alice' });
      setDocument(kv, author2Key, { __typename: 'Author', id: 2, name: 'Bob' });

      // Pre-populate posts with nested author __entityRef
      const post1Key = hashValue(['Post', 10]);
      const post2Key = hashValue(['Post', 20]);
      setDocument(
        kv,
        post1Key,
        { __typename: 'Post', id: 10, title: 'First Post', author: { __entityRef: author1Key } },
        new Set([author1Key]),
      );
      setDocument(
        kv,
        post2Key,
        { __typename: 'Post', id: 20, title: 'Second Post', author: { __entityRef: author2Key } },
        new Set([author2Key]),
      );

      // Pre-populate blog with array of post __entityRef
      const blogKey = hashValue(['Blog', 1]);
      setDocument(
        kv,
        blogKey,
        {
          __typename: 'Blog',
          id: 1,
          posts: [{ __entityRef: post1Key }, { __entityRef: post2Key }],
        },
        new Set([post1Key, post2Key]),
      );

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetBlog, { id: '1' });
      setDocument(kv, rootEntityKey, { __queryId: rootEntityKey, blog: { __entityRef: blogKey } }, new Set([blogKey]));

      // Set up query result as a ref to the root entity
      setQuery(kv, GetBlog, { id: '1' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

      mockFetch.get('/blogs/[id]', { blog: { __typename: 'Blog', id: 1, posts: [] } }, { delay: 100 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBlog, { id: '1' });
        relay.value;
        await sleep();

        const result = relay.value;
        expect(result?.blog).toBeDefined();
        expect(result?.blog.posts).toHaveLength(2);

        // Each post should be resolved and have its nested author resolved
        const posts = result?.blog.posts as any[];
        expect(posts[0].title).toBe('First Post');
        expect(posts[0].author.name).toBe('Alice');
        expect(posts[1].title).toBe('Second Post');
        expect(posts[1].author.name).toBe('Bob');
      });
    });

    it('should resolve deeply nested entities through multiple array levels from cache', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        label = t.string;
      }

      class Comment extends Entity {
        __typename = t.typename('Comment');
        id = t.id;
        text = t.string;
        tag = t.entity(Tag);
      }

      class Thread extends Entity {
        __typename = t.typename('Thread');
        id = t.id;
        title = t.string;
        comments = t.array(t.entity(Comment));
      }

      class Forum extends Entity {
        __typename = t.typename('Forum');
        id = t.id;
        threads = t.array(t.entity(Thread));
      }

      class GetForum extends RESTQuery {
        params = { id: t.id };
        path = `/forums/${this.params.id}`;
        result = { forum: t.entity(Forum) };
      }

      // Pre-populate tags
      const tag1Key = hashValue(['Tag', 1]);
      const tag2Key = hashValue(['Tag', 2]);
      setDocument(kv, tag1Key, { __typename: 'Tag', id: 1, label: 'question' });
      setDocument(kv, tag2Key, { __typename: 'Tag', id: 2, label: 'answer' });

      // Pre-populate comments with nested tag __entityRef
      const comment1Key = hashValue(['Comment', 100]);
      const comment2Key = hashValue(['Comment', 200]);
      const comment3Key = hashValue(['Comment', 300]);
      setDocument(
        kv,
        comment1Key,
        { __typename: 'Comment', id: 100, text: 'First comment', tag: { __entityRef: tag1Key } },
        new Set([tag1Key]),
      );
      setDocument(
        kv,
        comment2Key,
        { __typename: 'Comment', id: 200, text: 'Second comment', tag: { __entityRef: tag2Key } },
        new Set([tag2Key]),
      );
      setDocument(
        kv,
        comment3Key,
        { __typename: 'Comment', id: 300, text: 'Third comment', tag: { __entityRef: tag1Key } },
        new Set([tag1Key]),
      );

      // Pre-populate threads with array of comment __entityRef
      const thread1Key = hashValue(['Thread', 10]);
      const thread2Key = hashValue(['Thread', 20]);
      setDocument(
        kv,
        thread1Key,
        {
          __typename: 'Thread',
          id: 10,
          title: 'Thread One',
          comments: [{ __entityRef: comment1Key }, { __entityRef: comment2Key }],
        },
        new Set([comment1Key, comment2Key]),
      );
      setDocument(
        kv,
        thread2Key,
        {
          __typename: 'Thread',
          id: 20,
          title: 'Thread Two',
          comments: [{ __entityRef: comment3Key }],
        },
        new Set([comment3Key]),
      );

      // Pre-populate forum with array of thread __entityRef
      const forumKey = hashValue(['Forum', 1]);
      setDocument(
        kv,
        forumKey,
        {
          __typename: 'Forum',
          id: 1,
          threads: [{ __entityRef: thread1Key }, { __entityRef: thread2Key }],
        },
        new Set([thread1Key, thread2Key]),
      );

      // Set up root entity data (wrapping the query result)
      const rootEntityKey = computeRootEntityKey(GetForum, { id: '1' });
      setDocument(
        kv,
        rootEntityKey,
        { __queryId: rootEntityKey, forum: { __entityRef: forumKey } },
        new Set([forumKey]),
      );

      // Set up query result as a ref to the root entity
      setQuery(kv, GetForum, { id: '1' }, { __entityRef: rootEntityKey }, new Set([rootEntityKey]));

      mockFetch.get('/forums/[id]', { forum: { __typename: 'Forum', id: 1, threads: [] } }, { delay: 100 });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetForum, { id: '1' });
        relay.value;
        await sleep();

        const result = relay.value;
        expect(result?.forum).toBeDefined();
        expect(result?.forum.threads).toHaveLength(2);

        // Thread 1 with its comments and their tags
        const threads = result?.forum.threads as any[];
        expect(threads[0].title).toBe('Thread One');
        expect(threads[0].comments).toHaveLength(2);
        expect(threads[0].comments[0].text).toBe('First comment');
        expect(threads[0].comments[0].tag.label).toBe('question');
        expect(threads[0].comments[1].text).toBe('Second comment');
        expect(threads[0].comments[1].tag.label).toBe('answer');

        // Thread 2 with its comment and tag
        expect(threads[1].title).toBe('Thread Two');
        expect(threads[1].comments).toHaveLength(1);
        expect(threads[1].comments[0].text).toBe('Third comment');
        expect(threads[1].comments[0].tag.label).toBe('question');
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

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
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
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        // Check reference count
        const postKey = hashValue(['Post', 1]);
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
        class GetUser1 extends RESTQuery {
          path = '/user/profile';
          result = { user: t.entity(User) };
        }

        class GetUser2 extends RESTQuery {
          path = '/user/details';
          result = { user: t.entity(User) };
        }

        const relay1 = fetchQuery(GetUser1);
        await relay1;

        const relay2 = fetchQuery(GetUser2);
        await relay2;

        // Entity should have references from queries
        // Each query stores refs to [rootEntity, userEntity], and each root entity
        // also stores refs to [userEntity], so the user has 4 total refs.
        const userKey = hashValue(['User', 1]);
        const refCount = await kv.getNumber(refCountKeyFor(userKey));

        expect(refCount).toBe(4);
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
        class GetUser extends RESTQuery {
          params = { id: t.id };
          path = `/users/${this.params.id}`;
          result = { user: t.entity(User) };
        }

        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        // Check that query and entity are stored
        const queryKey = queryKeyForClass(GetUser, { id: '1' });
        const userKey = hashValue(['User', 1]);

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

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
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
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const userKey = hashValue(['User', 1]);
        const postKey = hashValue(['Post', 42]);

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
      class GetUser extends RESTQuery {
        static cache = { maxCount: 2 };
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/users/1', { user: { __typename: 'User', id: 1, name: 'User 1' } });
      mockFetch.get('/users/2', { user: { __typename: 'User', id: 2, name: 'User 2' } });
      mockFetch.get('/users/3', { user: { __typename: 'User', id: 3, name: 'User 3' } });

      await testWithClient(client, async () => {
        // Fetch 3 users, the third should evict the first
        const relay1 = fetchQuery(GetUser, { id: '1' });
        await relay1;

        const relay2 = fetchQuery(GetUser, { id: '2' });
        await relay2;

        const query1Key = queryKeyForClass(GetUser, { id: '1' });
        const query2Key = queryKeyForClass(GetUser, { id: '2' });
        const query3Key = queryKeyForClass(GetUser, { id: '3' });

        const user1Key = hashValue(['User', 1]);
        const user2Key = hashValue(['User', 2]);
        const user3Key = hashValue(['User', 3]);

        // Query 1 and 2 should exist
        expect(getDocument(kv, query1Key)).toBeDefined();
        expect(getDocument(kv, query2Key)).toBeDefined();

        // User 1 and 2 should exist
        expect(getDocument(kv, user1Key)).toBeDefined();
        expect(getDocument(kv, user2Key)).toBeDefined();

        // Fetch user 3, should evict user 1's query
        const relay3 = fetchQuery(GetUser, { id: '3' });
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

      class GetProfile extends RESTQuery {
        static cache = { maxCount: 1 };
        params = { id: t.id };
        path = `/user/profile/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      class GetDetails extends RESTQuery {
        params = { id: t.id };
        path = `/user/details/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/profile/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/user/details/1', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        // Both queries reference the same user
        const relay1 = fetchQuery(GetProfile, { id: '1' });
        await relay1;

        const relay2 = fetchQuery(GetDetails, { id: '1' });
        await relay2;

        const userKey = hashValue(['User', 1]);

        // User should have ref count of 4 (each query refs [rootEntity, user],
        // and each root entity also refs [user])
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(4);

        // Force eviction of first query by making another profile request
        mockFetch.get('/user/profile/2', {
          user: { __typename: 'User', id: 2, name: 'Bob' },
        });

        const relay3 = fetchQuery(GetProfile, { id: '2' });
        await relay3;

        // Original user should still exist (referenced by details query)
        // Ref count drops by 2 (query ref + cascade-deleted root entity ref)
        expect(getDocument(kv, userKey)).toBeDefined();
        expect(await kv.getNumber(refCountKeyFor(userKey))).toBe(2);
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

      class GetUser extends RESTQuery {
        static cache = { maxCount: 1 };
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      await testWithClient(client, async () => {
        const relay1 = fetchQuery(GetUser, { id: '1' });
        await relay1;

        const userKey = hashValue(['User', 1]);
        const postKey = hashValue(['Post', 10]);
        const tagKey = hashValue(['Tag', 100]);

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

        const relay2 = fetchQuery(GetUser, { id: '2' });
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

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
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
        relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        post10Key = hashValue(['Post', 10]);

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
        const post20Key = hashValue(['Post', 20]);

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
        class GetPosts extends RESTQuery {
          path = '/posts';
          result = { posts: t.array(t.entity(Post)) };
        }

        const relay = fetchQuery(GetPosts);
        const result = await relay;

        expect(result.posts.length).toEqual(3);

        const postKey = hashValue(['Post', 1]);
        const queryKey = queryKeyForClass(GetPosts, undefined);

        // Query should reference post 1 (and root entity)
        const refs = await kv.getBuffer(refIdsKeyFor(queryKey));
        expect(refs).toBeDefined();
        expect(Array.from(refs!).filter(id => id === postKey).length).toBe(1);

        // Post should have ref count of 2 (one from query refs, one from root entity refs)
        expect(await kv.getNumber(refCountKeyFor(postKey))).toBe(2);
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

      class GetUser extends RESTQuery {
        static cache = { maxCount: 1 };
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      await testWithClient(client, async () => {
        const relay1 = fetchQuery(GetUser, { id: '1' });
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

        const relay2 = fetchQuery(GetUser, { id: '2' });
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

      class GetUser extends RESTQuery {
        static cache = { maxCount: 1 };
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      await testWithClient(client, async () => {
        const relay1 = fetchQuery(GetUser, { id: '1' });
        await relay1;

        const userKey = hashValue(['User', 1]);
        const postKey = hashValue(['Post', 10]);

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

        const relay2 = fetchQuery(GetUser, { id: '2' });
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
        class GetPositionV1 extends RESTQuery {
          params = { id: t.id };
          path = `/positions/${this.params.id}`;
          result = { position: t.entity(PositionV1) };
        }

        // Fetch with V1 schema
        const relay1 = fetchQuery(GetPositionV1, { id: '123' });
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
        class GetPositionV2 extends RESTQuery {
          params = { id: t.id };
          path = `/positions/${this.params.id}`;
          result = { position: t.entity(PositionV2) };
        }

        // Fetch with V2 schema - this should NOT throw a validation error
        const relay2 = fetchQuery(GetPositionV2, { id: '123' });
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
        class GetUserV1 extends RESTQuery {
          path = '/users/v1';
          result = { user: t.entity(UserV1) };
        }

        const relay1 = fetchQuery(GetUserV1);
        await relay1;
      });

      // Fetch same user with V2 schema (different endpoint to avoid query cache)
      mockFetch.get('/users/v2', {
        user: { __typename: 'User', id: 1, name: 'Alice', email: 'alice@example.com' },
      });

      await testWithClient(client, async () => {
        class GetUserV2 extends RESTQuery {
          path = '/users/v2';
          result = { user: t.entity(UserV2) };
        }

        const relay2 = fetchQuery(GetUserV2);
        await relay2;
      });

      // Both shapes share the same unified entity key
      const entityKey = hashValue(['User', 1]);
      const entity = getDocument(kv, entityKey);

      expect(entity).toBeDefined();
      expect((entity as any).name).toBe('Alice');
      // V2 data is merged into the unified entity
      expect((entity as any).email).toBe('alice@example.com');
    });
  });

  describe('Stale Query Purge', () => {
    it('should write lastUsedAt and cacheTime metadata on activateQuery', async () => {
      mockFetch.get('/items/[id]', { id: 1, name: 'Test' });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          params = { id: t.id };
          path = `/items/${this.params.id}`;
          result = { id: t.number, name: t.string };
        }

        const relay = fetchQuery(GetItem, { id: '1' });
        await relay;

        const queryDefId = 'GET:/items/[params.id]';
        const lastUsed = kv.getNumber(lastUsedKeyFor(queryDefId));
        const cacheTime = kv.getNumber(cacheTimeKeyFor(queryDefId));

        expect(lastUsed).toBeDefined();
        expect(lastUsed).toBeGreaterThan(0);
        expect(cacheTime).toBe(60 * 24);
      });
    });

    it('should purge expired queries on purgeStaleQueries', () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/purge-items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryDefId = 'GET:/purge-items/[params.id]';
      const queryKey = queryKeyForClass(GetItem, { id: '1' });

      setDocument(kv, queryKey, { id: 1, name: 'Old Data' });
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 100_000_000);

      const queue = new Uint32Array(50);
      queue[0] = queryKey;
      kv.setBuffer(queueKeyFor(queryDefId), queue);

      kv.setNumber(lastUsedKeyFor(queryDefId), Date.now() - 100_000_000);
      kv.setNumber(cacheTimeKeyFor(queryDefId), 60 * 24);

      expect(kv.getString(valueKeyFor(queryKey))).toBeDefined();

      store.purgeStaleQueries();

      expect(kv.getString(valueKeyFor(queryKey))).toBeUndefined();
      expect(kv.getNumber(updatedAtKeyFor(queryKey))).toBeUndefined();
      expect(kv.getBuffer(queueKeyFor(queryDefId))).toBeUndefined();
      expect(kv.getNumber(lastUsedKeyFor(queryDefId))).toBeUndefined();
      expect(kv.getNumber(cacheTimeKeyFor(queryDefId))).toBeUndefined();
    });

    it('should not purge fresh queries', () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/fresh-items/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryDefId = 'GET:/fresh-items/[params.id]';
      const queryKey = queryKeyForClass(GetItem, { id: '1' });

      setDocument(kv, queryKey, { id: 1, name: 'Fresh Data' });
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      const queue = new Uint32Array(50);
      queue[0] = queryKey;
      kv.setBuffer(queueKeyFor(queryDefId), queue);

      kv.setNumber(lastUsedKeyFor(queryDefId), Date.now());
      kv.setNumber(cacheTimeKeyFor(queryDefId), 60 * 24);

      store.purgeStaleQueries();

      expect(kv.getString(valueKeyFor(queryKey))).toBeDefined();
      expect(kv.getBuffer(queueKeyFor(queryDefId))).toBeDefined();
      expect(kv.getNumber(lastUsedKeyFor(queryDefId))).toBeDefined();
    });

    it('should cascade-delete orphaned entities when purging stale queries', () => {
      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/purge-users/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryDefId = 'GET:/purge-users/[params.id]';
      const queryKey = queryKeyForClass(GetUser, { id: '1' });
      const entityKey = hashValue(['User', 1]);

      // Set entity data (no manual ref count -- setDocument below handles it)
      setDocument(kv, entityKey, { id: 1, name: 'Entity Data' });

      // Set query with a reference to the entity -- this increments entity ref count to 1
      setDocument(kv, queryKey, { id: 1, name: 'Query Data' }, new Set([entityKey]));
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now() - 100_000_000);

      const queue = new Uint32Array(50);
      queue[0] = queryKey;
      kv.setBuffer(queueKeyFor(queryDefId), queue);

      kv.setNumber(lastUsedKeyFor(queryDefId), Date.now() - 100_000_000);
      kv.setNumber(cacheTimeKeyFor(queryDefId), 60 * 24);

      expect(kv.getString(valueKeyFor(entityKey))).toBeDefined();
      expect(kv.getNumber(refCountKeyFor(entityKey))).toBe(1);

      store.purgeStaleQueries();

      expect(kv.getString(valueKeyFor(queryKey))).toBeUndefined();
      expect(kv.getString(valueKeyFor(entityKey))).toBeUndefined();
      expect(kv.getNumber(refCountKeyFor(entityKey))).toBeUndefined();
    });

    it('should respect custom cacheTime when purging', () => {
      class GetLongLived extends RESTQuery {
        static cache = { cacheTime: 60 * 24 * 30 }; // 30 days
        params = { id: t.id };
        path = `/long-lived/${this.params.id}`;
        result = { id: t.number };
      }

      const queryDefId = 'GET:/long-lived/[params.id]';
      const queryKey = queryKeyForClass(GetLongLived, { id: '1' });

      setDocument(kv, queryKey, { id: 1 });
      kv.setNumber(updatedAtKeyFor(queryKey), Date.now());

      const queue = new Uint32Array(50);
      queue[0] = queryKey;
      kv.setBuffer(queueKeyFor(queryDefId), queue);

      // Last used 2 days ago -- within 30-day cacheTime
      kv.setNumber(lastUsedKeyFor(queryDefId), Date.now() - 2 * 24 * 60 * 60 * 1000);
      kv.setNumber(cacheTimeKeyFor(queryDefId), 60 * 24 * 30);

      store.purgeStaleQueries();

      expect(kv.getString(valueKeyFor(queryKey))).toBeDefined();
    });

    it('should purge multiple entries from the same queue', () => {
      class GetItem extends RESTQuery {
        params = { id: t.id };
        path = `/multi-purge/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const queryDefId = 'GET:/multi-purge/[params.id]';
      const key1 = queryKeyForClass(GetItem, { id: '1' });
      const key2 = queryKeyForClass(GetItem, { id: '2' });
      const key3 = queryKeyForClass(GetItem, { id: '3' });

      setDocument(kv, key1, { id: 1, name: 'One' });
      kv.setNumber(updatedAtKeyFor(key1), Date.now() - 100_000_000);
      setDocument(kv, key2, { id: 2, name: 'Two' });
      kv.setNumber(updatedAtKeyFor(key2), Date.now() - 100_000_000);
      setDocument(kv, key3, { id: 3, name: 'Three' });
      kv.setNumber(updatedAtKeyFor(key3), Date.now() - 100_000_000);

      const queue = new Uint32Array(50);
      queue[0] = key1;
      queue[1] = key2;
      queue[2] = key3;
      kv.setBuffer(queueKeyFor(queryDefId), queue);

      kv.setNumber(lastUsedKeyFor(queryDefId), Date.now() - 100_000_000);
      kv.setNumber(cacheTimeKeyFor(queryDefId), 60 * 24);

      store.purgeStaleQueries();

      expect(kv.getString(valueKeyFor(key1))).toBeUndefined();
      expect(kv.getString(valueKeyFor(key2))).toBeUndefined();
      expect(kv.getString(valueKeyFor(key3))).toBeUndefined();
      expect(kv.getBuffer(queueKeyFor(queryDefId))).toBeUndefined();
    });
  });
});
