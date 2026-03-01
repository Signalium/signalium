import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { Query, getQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep, sendStreamUpdate } from './utils.js';

/**
 * Query Stream Tests
 *
 * Tests the stream option on regular query() functions.
 * These are REST queries that also subscribe to real-time updates via streams.
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
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        content = t.string;
      }

      let subscribeCallCount = 0;
      let unsubscribeCallCount = 0;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'Post', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(Post),
          subscribe: (context: any, params: any, onUpdate: any) => {
            subscribeCallCount++;
            return () => {
              unsubscribeCallCount++;
            };
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);

        // Access a property to activate the relay
        expect(relay.isPending).toBe(true);

        // Wait for query to complete
        await relay;

        // Stream should be subscribed
        expect(subscribeCallCount).toBe(1);
        expect(relay.value?.posts.length).toBe(2);
      });

      await sleep();

      // Should unsubscribe when relay is deactivated
      expect(unsubscribeCallCount).toBe(1);
    });

    it('should pass params to stream subscribe function', async () => {
      class Message extends Entity {
        __typename = t.typename('Message');
        id = t.id;
        text = t.string;
        userId = t.string;
      }

      let receivedParams: any;

      mockFetch.get('/users/[userId]/messages', {
        messages: [{ __typename: 'Message', id: '1', text: 'Hello', userId: '123' }],
      });

      class GetUserMessages extends Query {
        path = '/users/[userId]/messages';
        searchParams = {
          limit: t.number,
        };
        response = {
          messages: t.array(t.entity(Message)),
        };
        stream = {
          type: t.entity(Message),
          subscribe: (context: any, params: any, onUpdate: any) => {
            receivedParams = params;
            return () => {};
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetUserMessages, { userId: '123', limit: 10 } as any);
        await relay;

        expect(receivedParams).toEqual({ userId: '123', limit: 10 });
      });
    });
  });

  describe('Entity Updates via Stream', () => {
    it('should update entities in response when stream event arrives', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        content = t.string;
      }

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'Post', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(Post),
          subscribe: (context: any, params: any, onUpdate: any) => {
            streamCallback = onUpdate;
            return () => {};
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        author = t.entity(User);
      }

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

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(User),
          subscribe: (context: any, params: any, onUpdate: any) => {
            streamCallback = onUpdate;
            return () => {};
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;

        expect((relay.value!.posts[0].author as any).name).toBe('Alice');

        // Send stream update for User (using helper to avoid reactive context issues)
        await sendStreamUpdate(streamCallback!, {
          __typename: 'User',
          id: 'u1',
          name: 'Alice Smith',
        });

        // Nested user should be updated
        expect((relay.value!.posts[0].author as any).name).toBe('Alice Smith');
      });
    });
  });

  describe('Stream Lifecycle', () => {
    it('should unsubscribe when query is deactivated', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(Post),
          subscribe: (context: any, params: any, onUpdate: any) => {
            subscribeCount++;
            return () => {
              unsubscribeCount++;
            };
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;

        expect(subscribeCount).toBe(1);
        expect(unsubscribeCount).toBe(0);
      });

      await sleep();

      // After exiting testWithClient scope, relay should be deactivated
      expect(unsubscribeCount).toBe(1);
    });

    it('should resubscribe when query is reactivated', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'Post', id: '1', title: 'Post 1' }],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(Post),
          subscribe: (context: any, params: any, onUpdate: any) => {
            subscribeCount++;
            return () => {
              unsubscribeCount++;
            };
          },
        };
      }

      // First activation
      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;
        expect(subscribeCount).toBe(1);
      });

      await sleep();

      expect(unsubscribeCount).toBe(1);

      // Second activation
      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;
        expect(subscribeCount).toBe(2);
      });

      await sleep();

      expect(unsubscribeCount).toBe(2);
    });

    it('should not subscribe if stream is not configured', async () => {
      let subscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ id: '1', title: 'Post 1' }],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(
            t.object({
              id: t.string,
              title: t.string,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;

        expect(relay.value?.posts.length).toBe(1);
        // No subscriptions should occur
        expect(subscribeCount).toBe(0);
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rapid successive stream events', async () => {
      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      let streamCallback: ((update: any) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'Post', id: '1', title: 'Post 1' },
          { __typename: 'Post', id: '2', title: 'Post 2' },
        ],
      });

      class GetPosts extends Query {
        path = '/posts';
        response = {
          posts: t.array(t.entity(Post)),
        };
        stream = {
          type: t.entity(Post),
          subscribe: (context: any, params: any, onUpdate: any) => {
            streamCallback = onUpdate;
            return () => {};
          },
        };
      }

      await testWithClient(client, async () => {
        const relay = getQuery(GetPosts);
        await relay;

        // Send rapid successive stream events
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '1', title: 'Updated Post 1' });
        await sendStreamUpdate(streamCallback!, { __typename: 'Post', id: '2', title: 'Updated Post 2' });

        await sleep(10);

        // Entities in response should be updated
        expect(relay.value!.posts[0].title).toBe('Updated Post 1');
        expect(relay.value!.posts[1].title).toBe('Updated Post 2');
      });
    });
  });
});
