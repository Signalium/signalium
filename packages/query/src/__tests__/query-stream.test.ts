import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient, sendStreamUpdate } from './utils.js';

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
});
