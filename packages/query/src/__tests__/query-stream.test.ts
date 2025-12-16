import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query, infiniteQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep, sendStreamUpdate } from './utils.js';

/**
 * Query Stream Tests
 *
 * Tests the stream option on regular query() and infiniteQuery() functions.
 * This is different from streamQuery() - these are REST queries that also
 * subscribe to real-time updates via streams.
 */

describe('Query Stream Option', () => {
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

  describe('Basic Stream Subscription', () => {
    it('should subscribe to stream when query is activated', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
      }));

      let subscribeCallCount = 0;
      let unsubscribeCallCount = 0;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'Post', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        stream: {
          type: Post,
          subscribe: (context, params, onUpdate) => {
            subscribeCallCount++;
            return () => {
              unsubscribeCallCount++;
            };
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();

        // Access a property to activate the relay
        expect(relay.isPending).toBe(true);

        // Wait for query to complete
        await relay;

        // Stream should be subscribed
        expect(subscribeCallCount).toBe(1);
        expect(relay.value?.posts.length).toBe(2);
      });

      // Should unsubscribe when relay is deactivated
      expect(unsubscribeCallCount).toBe(1);
    });

    it('should pass params to stream subscribe function', async () => {
      const Message = entity(() => ({
        __typename: t.typename('Message'),
        id: t.id,
        text: t.string,
        userId: t.string,
      }));

      let receivedParams: any;

      mockFetch.get('/users/[userId]/messages', {
        messages: [{ __typename: 'Message', id: '1', text: 'Hello', userId: '123' }],
      });

      const getUserMessages = query(() => ({
        path: '/users/[userId]/messages',
        searchParams: {
          limit: t.number,
        },
        response: {
          messages: t.array(Message),
        },
        stream: {
          type: Message,
          subscribe: (context, params, onUpdate) => {
            receivedParams = params;
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getUserMessages({ userId: '123', limit: 10 });
        await relay;

        expect(receivedParams).toEqual({ userId: '123', limit: 10 });
      });
    });
  });

  describe('Entity Updates via Stream', () => {
    it('should update entities in response when stream event arrives', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'Post', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        const initialPosts = relay.value!.posts;
        expect(initialPosts[0].title).toBe('Post 1');

        // Send stream update for Post 1 (using helper to avoid reactive context issues)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'Post',
          id: '1',
          title: 'Updated Post 1',
        });

        // Post should be updated in the array
        expect(relay.value!.posts[0].title).toBe('Updated Post 1');
        expect(relay.value!.posts[0].content).toBe('Content 1'); // Should preserve other fields
      });
    });

    it('should update nested entities in response', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        author: User,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          {
            __typename: 'Post',
            id: '1',
            title: 'Post 1',
            author: { __typename: 'User', id: 'u1', name: 'Alice' },
          },
        ],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(Post),
        },
        stream: {
          type: User,
          subscribe: (context, params, onUpdate) => {
            streamCallback = onUpdate;
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.value!.posts[0].author.name).toBe('Alice');

        // Send stream update for User (using helper to avoid reactive context issues)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'User',
          id: 'u1',
          name: 'Alice Smith',
        });

        // Nested user should be updated
        expect(relay.value!.posts[0].author.name).toBe('Alice Smith');
      });
    });
  });

  describe('Orphaned Entities', () => {
    it('should add entities to orphans array when not in response', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' }],
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.value!.posts.length).toBe(1);
        expect(relay.extra.streamOrphans.size).toBe(0);

        // Send stream event for a post not in the response (using helper)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'Post',
          id: '99',
          title: 'Orphaned Post',
          content: 'Not in response',
        });

        // Should be added to orphans
        expect(relay.extra.streamOrphans.size).toBe(1);
        const orphan = Array.from(relay.extra.streamOrphans)[0] as any;
        expect(orphan.id).toBe('99');
        expect(orphan.title).toBe('Orphaned Post');

        // Original posts should not be affected
        expect(relay.value!.posts.length).toBe(1);
      });
    });

    it('should not duplicate orphans when same entity is updated', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' }],
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Send orphaned post
        streamCallback!({
          __typename: 'Post',
          id: '99',
          title: 'Orphaned Post',
          content: 'First version',
        });

        await sleep(10);
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Update the same orphaned post
        streamCallback!({
          __typename: 'Post',
          id: '99',
          title: 'Updated Orphaned Post',
        });

        await sleep(10);

        // Should still only have one orphan
        expect(relay.extra.streamOrphans.size).toBe(1);
        const orphan = Array.from(relay.extra.streamOrphans)[0] as any;
        expect(orphan.title).toBe('Updated Orphaned Post');
      });
    });

    it('should handle multiple orphans from different stream events', async () => {
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Send multiple orphaned posts
        streamCallback!({ __typename: 'Post', id: '99', title: 'Orphan 99' });
        await sleep(10);

        streamCallback!({ __typename: 'Post', id: '100', title: 'Orphan 100' });
        await sleep(10);

        streamCallback!({ __typename: 'Post', id: '101', title: 'Orphan 101' });
        await sleep(10);

        // Should have 3 orphans
        expect(relay.extra.streamOrphans.size).toBe(3);
        const orphanIds = Array.from(relay.extra.streamOrphans).map((o: any) => o.id);
        expect(orphanIds).toContain('99');
        expect(orphanIds).toContain('100');
        expect(orphanIds).toContain('101');
      });
    });
  });

  describe('Orphan Reconciliation', () => {
    it('should remove orphans when they appear in refetched response', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      // Initial response with just post 1
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add orphaned post
        streamCallback!({ __typename: 'Post', id: '99', title: 'Orphan 99' });
        await sleep(10);
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Mock a refetch that includes the orphaned post
        mockFetch.get('/posts', {
          posts: [
            { __typename: 'Post', id: '1', title: 'Post 1' },
            { __typename: 'Post', id: '99', title: 'Orphan 99' },
          ],
        });

        await relay.refetch();

        // Orphan should be removed since it's now in the response
        expect(relay.extra.streamOrphans.size).toBe(0);
        expect(relay.value!.posts.length).toBe(2);
        expect(relay.value!.posts.some((p: any) => p.id === '99')).toBe(true);
      });
    });

    it('should not re-add orphans when entities are removed from response', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      // Initial response with posts 1 and 2
      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1' },
          { __typename: 'Post', id: '2', title: 'Post 2' },
        ],
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.extra.streamOrphans.size).toBe(0);

        // Mock a refetch that removes post 2
        mockFetch.get('/posts', {
          posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
        });

        await relay.refetch();

        // Post 2 should not be added to orphans
        expect(relay.extra.streamOrphans.size).toBe(0);
        expect(relay.value!.posts.length).toBe(1);

        // Even if a stream update comes for post 2
        streamCallback!({ __typename: 'Post', id: '2', title: 'Updated Post 2' });
        await sleep(10);

        // It should now be orphaned
        expect(relay.extra.streamOrphans.size).toBe(1);
      });
    });

    it('should clear all orphans on full refetch', async () => {
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add multiple orphans
        streamCallback!({ __typename: 'Post', id: '99', title: 'Orphan 99' });
        streamCallback!({ __typename: 'Post', id: '100', title: 'Orphan 100' });
        await sleep(10);
        expect(relay.extra.streamOrphans.size).toBe(2);

        // Refetch
        mockFetch.get('/posts', {
          posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
        });

        await relay.refetch();

        // All orphans should be cleared
        expect(relay.extra.streamOrphans.size).toBe(0);
      });
    });
  });

  describe('Infinite Query with Stream', () => {
    it('should support stream on infinite queries', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        page: t.number,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1', page: 1 },
          { __typename: 'Post', id: '2', title: 'Post 2', page: 1 },
        ],
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
        stream: {
          type: Post,
          subscribe: (context, params, onUpdate) => {
            streamCallback = onUpdate;
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts({ page: 1 });
        await relay;

        expect(relay.value!.length).toBe(1);
        expect(relay.value![0].posts.length).toBe(2);
        expect(relay.extra.streamOrphans.size).toBe(0);

        // Send stream update for post in first page (using helper)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'Post',
          id: '1',
          title: 'Updated Post 1',
        });

        // Should update the entity
        expect(relay.value![0].posts[0].title).toBe('Updated Post 1');
        expect(relay.extra.streamOrphans.size).toBe(0);

        // Send stream update for orphaned post (using helper)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'Post',
          id: '99',
          title: 'Orphaned Post',
          page: 1,
        });

        // Should be added to orphans
        expect(relay.extra.streamOrphans.size).toBe(1);
      });
    });

    it('should reconcile orphans when fetching next page', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      // First page
      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1' },
          { __typename: 'Post', id: '2', title: 'Post 2' },
        ],
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
        stream: {
          type: Post,
          subscribe: (context, params, onUpdate) => {
            streamCallback = onUpdate;
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts({ page: 1 });
        await relay;

        // Add orphaned post
        streamCallback!({ __typename: 'Post', id: '99', title: 'Orphan 99' });
        await sleep(10);
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Mock second page that includes the orphaned post
        mockFetch.get('/posts', {
          posts: [
            { __typename: 'Post', id: '99', title: 'Orphan 99' },
            { __typename: 'Post', id: '3', title: 'Post 3' },
          ],
          nextPage: undefined,
        });

        await relay.fetchNextPage();

        // Orphan should be removed since it's now in the response
        expect(relay.extra.streamOrphans.size).toBe(0);
        expect(relay.value!.length).toBe(2);
        expect(relay.value![1].posts.some((p: any) => p.id === '99')).toBe(true);
      });
    });

    it('should track deep nested entities across paginated results', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        author: User,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      // First page
      mockFetch.get('/posts', {
        posts: [
          {
            __typename: 'Post',
            id: '1',
            title: 'Post 1',
            author: { __typename: 'User', id: 'u1', name: 'Alice' },
          },
        ],
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
        stream: {
          type: User,
          subscribe: (context, params, onUpdate) => {
            streamCallback = onUpdate;
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts({ page: 1 });
        await relay;

        // Update user that's in the response (nested) - using helper
        await sendStreamUpdate(streamCallback!, {
          __typename: 'User',
          id: 'u1',
          name: 'Alice Smith',
        });

        // Should update nested entity
        expect(relay.value![0].posts[0].author.name).toBe('Alice Smith');
        expect(relay.extra.streamOrphans.size).toBe(0);

        // Send stream for user not in response - using helper
        await sendStreamUpdate(streamCallback!, {
          __typename: 'User',
          id: 'u99',
          name: 'Bob',
        });

        // Should be orphaned
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Fetch second page with this user
        mockFetch.get('/posts', {
          posts: [
            {
              __typename: 'Post',
              id: '2',
              title: 'Post 2',
              author: { __typename: 'User', id: 'u99', name: 'Bob' },
            },
          ],
          nextPage: undefined,
        });

        await relay.fetchNextPage();

        // Orphan should be reconciled
        expect(relay.extra.streamOrphans.size).toBe(0);
        expect(relay.value![1].posts[0].author.name).toBe('Bob');
      });
    });
  });

  describe('Stream Lifecycle', () => {
    it('should unsubscribe when query is deactivated', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let subscribeCount = 0;
      let unsubscribeCount = 0;

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
            subscribeCount++;
            return () => {
              unsubscribeCount++;
            };
          },
        },
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(subscribeCount).toBe(1);
        expect(unsubscribeCount).toBe(0);
      });

      // After exiting testWithClient scope, relay should be deactivated
      expect(unsubscribeCount).toBe(1);
    });

    it('should resubscribe when query is reactivated', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let subscribeCount = 0;
      let unsubscribeCount = 0;

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
            subscribeCount++;
            return () => {
              unsubscribeCount++;
            };
          },
        },
      }));

      // First activation
      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;
        expect(subscribeCount).toBe(1);
      });

      expect(unsubscribeCount).toBe(1);

      // Second activation
      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;
        expect(subscribeCount).toBe(2);
      });

      expect(unsubscribeCount).toBe(2);
    });

    it('should not subscribe if stream is not configured', async () => {
      let subscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ id: '1', title: 'Post 1' }],
      });

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(
            t.object({
              id: t.string,
              title: t.string,
            }),
          ),
        },
        // No stream configured
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        expect(relay.value?.posts.length).toBe(1);
        // No subscriptions should occur
        expect(subscribeCount).toBe(0);
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rapid successive stream events', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1' },
          { __typename: 'Post', id: '2', title: 'Post 2' },
        ],
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Send rapid successive stream events (some updating entities in response, some orphans)
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '1', title: 'Updated Post 1' }); // In response
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '99', title: 'Orphan 99' }); // Orphan
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '2', title: 'Updated Post 2' }); // In response
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '100', title: 'Orphan 100' }); // Orphan

        await sleep(10);

        // Entities in response should be updated
        expect(relay.value!.posts[0].title).toBe('Updated Post 1');
        expect(relay.value!.posts[1].title).toBe('Updated Post 2');

        // Orphans should be added
        expect(relay.extra.streamOrphans.size).toBe(2);
        const orphanIds = Array.from(relay.extra.streamOrphans).map((o: any) => o.id);
        expect(orphanIds).toContain('99');
        expect(orphanIds).toContain('100');
      });
    });

    it('should handle stream events while refetch is in progress', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      let streamCallback: ((update: any) => void) | undefined;
      let fetchDelay = 0;

      mockFetch.get('/posts', async () => {
        if (fetchDelay > 0) {
          await sleep(fetchDelay);
        }
        return {
          posts: [
            { __typename: 'Post', id: '1', title: 'Post 1' },
            { __typename: 'Post', id: '2', title: 'Post 2' },
          ],
        };
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add an orphan - using helper
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '99', title: 'Orphan 99' });
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Start a slow refetch
        fetchDelay = 100;
        const refetchPromise = relay.refetch();

        // Send more stream updates while refetch is in progress - using helper
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '100', title: 'Orphan 100' });

        // Should have both orphans
        expect(relay.extra.streamOrphans.size).toBe(2);

        // Wait for refetch to complete
        await refetchPromise;

        // Orphans should be cleared after refetch
        expect(relay.extra.streamOrphans.size).toBe(0);
      });
    });

    it('should preserve orphans across multiple query parameter changes', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        category: t.string,
      }));

      let streamCallback1: ((update: any) => void) | undefined;
      let streamCallback2: ((update: any) => void) | undefined;

      // First query response (tech category)
      mockFetch.get('/posts', {
        posts: [
          {
            __typename: 'Post',
            id: '1',
            title: 'tech Post',
            category: 'tech',
          },
        ],
      });

      // Second query response (news category)
      mockFetch.get('/posts', {
        posts: [
          {
            __typename: 'Post',
            id: '2',
            title: 'news Post',
            category: 'news',
          },
        ],
      });

      const getPosts = query(() => ({
        path: '/posts',
        searchParams: {
          category: t.string,
        },
        response: {
          posts: t.array(Post),
        },
        stream: {
          type: Post,
          subscribe: (context, params, onUpdate) => {
            // Store callback for each query based on category param
            if (params?.category === 'tech') {
              streamCallback1 = onUpdate;
            } else {
              streamCallback2 = onUpdate;
            }
            return () => {};
          },
        },
      }));

      await testWithClient(client, async () => {
        // Query with category=tech
        const relay1 = getPosts({ category: 'tech' });
        await relay1;
        expect(relay1.value!.posts[0].category).toBe('tech');

        // Add orphan to first query
        streamCallback1!({
          __typename: 'Post',
          id: '99',
          title: 'Orphan 99',
          category: 'tech',
        });
        await sleep(10);
        expect(relay1.extra.streamOrphans.size).toBe(1);

        // Query with different category - this creates a different query instance
        const relay2 = getPosts({ category: 'news' });
        await relay2;
        expect(relay2.value!.posts[0].category).toBe('news');

        // relay2 should not have any orphans (it's a separate query)
        expect(relay2.extra.streamOrphans.size).toBe(0);

        // relay1 should still have its orphan
        expect(relay1.extra.streamOrphans.size).toBe(1);
      });
    });
  });

  describe('Stream Orphans Persistence', () => {
    it('should persist stream orphan refs to the store', async () => {
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
      }));

      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add orphaned posts using helper to avoid reactive context issues
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '99', title: 'Orphan 99' });
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '100', title: 'Orphan 100' });

        expect(relay.extra.streamOrphans.size).toBe(2);
      });

      // Wait for persistence to complete
      await sleep(10);

      // Verify that orphan refs are saved to the KV store
      const kvData = (kv as any).kv;
      const queryKey = Object.keys(kvData)
        .find(k => k.startsWith('sq:doc:updatedAt:'))
        ?.split(':')
        .pop();
      const streamOrphanRefs = kvData[`sq:doc:streamOrphanRefs:${queryKey}`];

      expect(streamOrphanRefs).toBeDefined();
      expect(streamOrphanRefs.length).toBe(2);
    });

    it('should persist cleared orphans after refetch', async () => {
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
      }));

      // First session - add orphans then refetch
      await testWithClient(client, async () => {
        const relay = getPosts();
        await relay;

        // Add orphaned post
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '99', title: 'Orphan 99' });
        expect(relay.extra.streamOrphans.size).toBe(1);

        // Refetch - should clear orphans
        await relay.refetch();
        expect(relay.extra.streamOrphans.size).toBe(0);
      });

      // Simulate client reload
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      // Second session - orphans should remain cleared
      await testWithClient(client2, async () => {
        const relay = getPosts();
        await relay;

        // Orphans should be empty after refetch was persisted
        expect(relay.extra.streamOrphans.size).toBe(0);
      });

      client2.destroy();
    });
  });
});
