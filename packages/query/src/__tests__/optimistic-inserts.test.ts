import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../QueryStore.js';
import { QueryClient, addOptimisticInsert, removeOptimisticInsert } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query, infiniteQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';

/**
 * Helper to send a stream update outside the reactive context.
 * This avoids "signal dirtied after consumed" errors.
 */
async function sendStreamUpdate(callback: (update: any) => void, update: any): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      callback(update);
      resolve();
    }, 0);
  });
  // Give time for update to propagate
  await sleep(10);
}

/**
 * Helper to perform an action outside the reactive context.
 * This avoids "signal dirtied after consumed" errors.
 */
async function runOutsideReactiveContext(action: () => void): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      action();
      resolve();
    }, 0);
  });
  await sleep(10);
}

/**
 * Optimistic Inserts Tests
 *
 * Tests the optimistic inserts feature which allows users to temporarily
 * add entities to a query result before they are confirmed by the server.
 */

describe('Optimistic Inserts', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Operations', () => {
    it('should throw error if query does not have optimisticInserts configured', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      // Query WITHOUT optimisticInserts config
      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Should throw because optimisticInserts is not configured
        expect(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'New Post' });
        }).toThrow('Query does not have optimisticInserts configured');
      });
    });

    it('should add optimistic insert with raw object payload', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.extra.optimisticInserts.size).toBe(0);

        // Add a raw object payload (not a proxy) - should be parsed
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'New Post' });
        });

        expect(relay.extra.optimisticInserts.size).toBe(1);
        const insert = Array.from(relay.extra.optimisticInserts)[0] as any;
        expect(insert.id).toBe('99');
        expect(insert.title).toBe('New Post');
      });
    });

    it('should add optimistic insert with entity proxy', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      // First query returns a post that we'll use as an entity proxy
      mockFetch.get('/post/99', {
        post: { __typename: 'Post', id: '99', title: 'Existing Post' },
      });

      // Second query (the one we'll add optimistic inserts to)
      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPost = query(() => ({
        path: '/post/99',
        response: {
          post: Post,
        },
      }));

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        // Load a single post to get its entity proxy
        const postRelay = getPost();
        await postRelay;
        const postProxy = postRelay.value!.post;

        // Load the posts list
        const postsRelay = getPosts();
        await postsRelay;

        expect(postsRelay.extra.optimisticInserts.size).toBe(0);

        // Add the entity proxy from the single post query as an optimistic insert
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(postsRelay, postProxy as Record<string, unknown>);
        });

        expect(postsRelay.extra.optimisticInserts.size).toBe(1);
        const insert = Array.from(postsRelay.extra.optimisticInserts)[0] as any;
        expect(insert.id).toBe('99');
        expect(insert.title).toBe('Existing Post');
      });
    });

    it('should not add optimistic insert if already in main response', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Try to add entity that's already in response
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '1', title: 'Post 1' });
        });

        // Should not be added because it's already in the response
        expect(relay.extra.optimisticInserts.size).toBe(0);
      });
    });

    it('should clear optimistic inserts on refetch', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add optimistic insert
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        // Refetch clears optimistic inserts
        await relay.refetch();

        expect(relay.extra.optimisticInserts.size).toBe(0);
      });
    });

    it('should remove optimistic insert when it appears in stream orphans', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        stream: {
          type: Post,
          subscribe: (context, params, onUpdate) => {
            streamCallback = onUpdate;
            return () => {};
          },
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add optimistic insert first
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        // Now same entity comes in via stream
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '99', title: 'From Stream' });

        // Should appear in stream orphans
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Optimistic insert should be removed
        expect(relay.extra.optimisticInserts.size).toBe(0);
      });
    });

    it('removeOptimisticInsert is a no-op if already removed', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add and then remove an optimistic insert
        let insert: Record<string, unknown>;
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'New Post' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        insert = Array.from(relay.extra.optimisticInserts)[0] as Record<string, unknown>;
        await runOutsideReactiveContext(() => {
          removeOptimisticInsert(relay, insert);
        });
        expect(relay.extra.optimisticInserts.size).toBe(0);

        // Calling removeOptimisticInsert again is a no-op
        await runOutsideReactiveContext(() => {
          removeOptimisticInsert(relay, insert);
        });
        expect(relay.extra.optimisticInserts.size).toBe(0);
      });
    });
  });

  describe('Infinite Query', () => {
    it('should preserve optimistic inserts when fetching next page', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      // First page
      mockFetch.get('/posts?page=1', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
        nextPage: 2,
      });

      // Second page
      mockFetch.get('/posts?page=2', {
        posts: [{ __typename: 'Post', id: '2', title: 'Post 2' }],
        nextPage: undefined,
      });

      const getPosts = infiniteQuery(() => ({
        path: '/posts',
        searchParams: {
          page: t.number,
        },
        response: {
          posts: t.array(Post),
          nextPage: t.optional(t.number),
        },
        pagination: {
          getNextPageParams: lastPage => {
            return lastPage.nextPage ? { page: lastPage.nextPage } : undefined;
          },
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts({ page: 1 });
        await relay;

        expect(relay.value!.length).toBe(1);
        expect(relay.extra.optimisticInserts.size).toBe(0);

        // Add optimistic insert
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic Post' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        // Fetch next page - should NOT clear optimistic inserts
        await relay.fetchNextPage();

        expect(relay.value!.length).toBe(2);
        expect(relay.extra.optimisticInserts.size).toBe(1);

        const insert = Array.from(relay.extra.optimisticInserts)[0] as any;
        expect(insert.id).toBe('99');
        expect(insert.title).toBe('Optimistic Post');
      });
    });

    it('should clear optimistic inserts on refetch for infinite query', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts?page=1', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
        nextPage: 2,
      });

      const getPosts = infiniteQuery(() => ({
        path: '/posts',
        searchParams: {
          page: t.number,
        },
        response: {
          posts: t.array(Post),
          nextPage: t.optional(t.number),
        },
        pagination: {
          getNextPageParams: lastPage => {
            return lastPage.nextPage ? { page: lastPage.nextPage } : undefined;
          },
        },
        optimisticInserts: {
          type: Post,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts({ page: 1 });
        await relay;

        // Add optimistic insert
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic Post' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        // Refetch - should clear optimistic inserts
        await relay.refetch();

        expect(relay.extra.optimisticInserts.size).toBe(0);
      });
    });
  });

  describe('Persistence', () => {
    it('should persist optimistic insert refs to the store', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
        cache: {
          staleTime: 60000, // Prevent refetch on reload
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add optimistic inserts
        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic 99' });
          addOptimisticInsert(relay, { __typename: 'Post', id: '100', title: 'Optimistic 100' });
        });

        expect(relay.extra.optimisticInserts.size).toBe(2);
      });

      // Wait for persistence to complete
      await sleep(10);

      // Verify that optimistic insert refs are saved to the KV store
      const kvData = (kv as any).kv;
      const queryKey = Object.keys(kvData)
        .find(k => k.startsWith('sq:doc:updatedAt:'))
        ?.split(':')
        .pop();
      const optimisticInsertRefs = kvData[`sq:doc:optimisticInsertRefs:${queryKey}`];

      expect(optimisticInsertRefs).toBeDefined();
      expect(optimisticInsertRefs.length).toBe(2);
    });

    it('should restore optimistic inserts on client reload', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
        cache: {
          staleTime: 60000, // Prevent refetch on reload
        },
      }));

      // First session - add optimistic inserts
      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic 99' });
          addOptimisticInsert(relay, { __typename: 'Post', id: '100', title: 'Optimistic 100' });
        });

        expect(relay.extra.optimisticInserts.size).toBe(2);
      });

      // Wait for persistence to complete
      await sleep(10);

      // Simulate client reload
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      // Second session - optimistic inserts should be restored
      await testWithClient(client2, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.extra.optimisticInserts.size).toBe(2);

        const inserts = Array.from(relay.extra.optimisticInserts) as any[];
        const ids = inserts.map(i => i.id).sort();
        expect(ids).toEqual(['100', '99']);
      });

      client2.destroy();
    });

    it('should persist cleared optimistic inserts after refetch', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
        cache: {
          staleTime: 60000, // Prevent refetch on reload
        },
      }));

      // First session - add optimistic insert then refetch
      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Optimistic 99' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);

        // Refetch - should clear optimistic inserts
        await relay.refetch();
        expect(relay.extra.optimisticInserts.size).toBe(0);
      });

      // Wait for persistence to complete
      await sleep(10);

      // Simulate client reload
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      // Second session - optimistic inserts should remain cleared
      await testWithClient(client2, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.extra.optimisticInserts.size).toBe(0);
      });

      client2.destroy();
    });

    it('should persist entity values for optimistic inserts', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        optimisticInserts: {
          type: Post,
        },
        cache: {
          staleTime: 60000,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        await runOutsideReactiveContext(() => {
          addOptimisticInsert(relay, { __typename: 'Post', id: '99', title: 'Persisted Post' });
        });
        expect(relay.extra.optimisticInserts.size).toBe(1);
      });

      // Wait for persistence to complete
      await sleep(10);

      // Verify the entity value is persisted
      const kvData = (kv as any).kv;
      const queryKey = Object.keys(kvData)
        .find(k => k.startsWith('sq:doc:updatedAt:'))
        ?.split(':')
        .pop();
      const optimisticInsertRefs = kvData[`sq:doc:optimisticInsertRefs:${queryKey}`];

      expect(optimisticInsertRefs).toBeDefined();
      expect(optimisticInsertRefs.length).toBe(1);

      const insertRefId = optimisticInsertRefs[0];
      const insertValue = kvData[`sq:doc:value:${insertRefId}`];
      expect(insertValue).toBeDefined();
      const parsedInsert = JSON.parse(insertValue);
      expect(parsedInsert.id).toBe('99');
      expect(parsedInsert.title).toBe('Persisted Post');
    });
  });
});
