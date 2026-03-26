import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep, sendStreamUpdate } from './utils.js';
import type { MutationEvent } from '../types.js';

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
        __typename = t.typename('StreamPost');
        id = t.id;
        title = t.string;
        content = t.string;
      }

      let subscribeCallCount = 0;
      let unsubscribeCallCount = 0;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'StreamPost', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'StreamPost', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              subscribeCallCount++;
              return () => {
                unsubscribeCallCount++;
              };
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);

        expect(relay.isPending).toBe(true);

        await relay;

        expect(subscribeCallCount).toBe(1);
        expect(relay.value?.posts.length).toBe(2);
      });

      await sleep();

      expect(unsubscribeCallCount).toBe(1);
    });

    it('should have access to this.params inside subscribe', async () => {
      class Message extends Entity {
        __typename = t.typename('StreamMessage');
        id = t.id;
        text = t.string;
        userId = t.string;
      }

      let receivedUserId: any;

      mockFetch.get('/users/[userId]/messages', {
        messages: [{ __typename: 'StreamMessage', id: '1', text: 'Hello', userId: '123' }],
      });

      class GetUserMessages extends RESTQuery {
        params = { userId: t.id, limit: t.number };
        path = `/users/${this.params.userId}/messages`;
        searchParams = { limit: this.params.limit };
        result = {
          messages: t.array(t.entity(Message)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              receivedUserId = this.params.userId;
              return () => {};
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUserMessages, { userId: '123', limit: 10 } as any);
        await relay;

        expect(receivedUserId).toBe('123');
      });
    });
  });

  describe('Entity Updates via Stream', () => {
    it('should update entities in response when stream event arrives', async () => {
      class Post extends Entity {
        __typename = t.typename('StreamUpdatePost');
        id = t.id;
        title = t.string;
        content = t.string;
      }

      let streamCallback: ((event: MutationEvent) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'StreamUpdatePost', id: '1', title: 'Post 1', content: 'Content 1' },
          { __typename: 'StreamUpdatePost', id: '2', title: 'Post 2', content: 'Content 2' },
        ],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              streamCallback = onEvent;
              return () => {};
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        const initialPosts = relay.value!.posts;
        expect(initialPosts[0].title).toBe('Post 1');

        await sendStreamUpdate(streamCallback!, {
          type: 'update',
          typename: 'StreamUpdatePost',
          data: { id: '1', title: 'Updated Post 1' },
        });

        expect(relay.value!.posts[0].title).toBe('Updated Post 1');
        expect(relay.value!.posts[0].content).toBe('Content 1');
      });
    });

    it('should update nested entities in response', async () => {
      class StreamAuthor extends Entity {
        __typename = t.typename('StreamAuthor');
        id = t.id;
        name = t.string;
      }

      class StreamNestedPost extends Entity {
        __typename = t.typename('StreamNestedPost');
        id = t.id;
        title = t.string;
        author = t.entity(StreamAuthor);
      }

      let streamCallback: ((event: MutationEvent) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          {
            __typename: 'StreamNestedPost',
            id: '1',
            title: 'Post 1',
            author: { __typename: 'StreamAuthor', id: 'u1', name: 'Alice' },
          },
        ],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(StreamNestedPost)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              streamCallback = onEvent;
              return () => {};
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        expect((relay.value!.posts[0].author as any).name).toBe('Alice');

        await sendStreamUpdate(streamCallback!, {
          type: 'update',
          typename: 'StreamAuthor',
          data: { id: 'u1', name: 'Alice Smith' },
        });

        expect((relay.value!.posts[0].author as any).name).toBe('Alice Smith');
      });
    });
  });

  describe('Stream Lifecycle', () => {
    it('should unsubscribe when query is deactivated', async () => {
      class Post extends Entity {
        __typename = t.typename('StreamLifecyclePost');
        id = t.id;
        title = t.string;
      }

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'StreamLifecyclePost', id: '1', title: 'Post 1' }],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              subscribeCount++;
              return () => {
                unsubscribeCount++;
              };
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        expect(subscribeCount).toBe(1);
        expect(unsubscribeCount).toBe(0);
      });

      await sleep();

      expect(unsubscribeCount).toBe(1);
    });

    it('should resubscribe when query is reactivated', async () => {
      class Post extends Entity {
        __typename = t.typename('StreamResubPost');
        id = t.id;
        title = t.string;
      }

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'StreamResubPost', id: '1', title: 'Post 1' }],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              subscribeCount++;
              return () => {
                unsubscribeCount++;
              };
            },
          };
        }
      }

      // First activation
      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;
        expect(subscribeCount).toBe(1);
      });

      await sleep();

      expect(unsubscribeCount).toBe(1);

      // Second activation
      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;
        expect(subscribeCount).toBe(2);
      });

      await sleep();

      expect(unsubscribeCount).toBe(2);
    });

    it('should not subscribe if subscribe is not overridden', async () => {
      let subscribeCount = 0;

      mockFetch.get('/posts', {
        posts: [{ id: '1', title: 'Post 1' }],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(
            t.object({
              id: t.string,
              title: t.string,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        expect(relay.value?.posts.length).toBe(1);
        expect(subscribeCount).toBe(0);
      });
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rapid successive stream events', async () => {
      class Post extends Entity {
        __typename = t.typename('StreamRapidPost');
        id = t.id;
        title = t.string;
      }

      let streamCallback: ((event: MutationEvent) => void) | undefined;

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'StreamRapidPost', id: '1', title: 'Post 1' },
          { __typename: 'StreamRapidPost', id: '2', title: 'Post 2' },
        ],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              streamCallback = onEvent;
              return () => {};
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        await sendStreamUpdate(streamCallback!, {
          type: 'update',
          typename: 'StreamRapidPost',
          data: { id: '1', title: 'Updated Post 1' },
        });
        await sendStreamUpdate(streamCallback!, {
          type: 'update',
          typename: 'StreamRapidPost',
          data: { id: '2', title: 'Updated Post 2' },
        });

        await sleep(10);

        expect(relay.value!.posts[0].title).toBe('Updated Post 1');
        expect(relay.value!.posts[1].title).toBe('Updated Post 2');
      });
    });
  });

  describe('Stream with this.params', () => {
    it('should unsubscribe old stream and resubscribe when Signal param changes', async () => {
      class Item extends Entity {
        __typename = t.typename('StreamResubItem');
        id = t.id;
        name = t.string;
      }

      const subscriptions: { channelId: any; unsubscribed: boolean }[] = [];

      mockFetch.get('/channels/[channelId]/items', {
        items: [{ __typename: 'StreamResubItem', id: '1', name: 'Item 1' }],
      });

      class GetChannelItems extends RESTQuery {
        params = { channelId: t.id };
        path = `/channels/${this.params.channelId}/items`;
        result = {
          items: t.array(t.entity(Item)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              const sub = { channelId: this.params.channelId, unsubscribed: false };
              subscriptions.push(sub);
              return () => {
                sub.unsubscribed = true;
              };
            },
          };
        }
      }

      const channelSignal = signal('ch-1');

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetChannelItems, { channelId: channelSignal });
        await relay;

        expect(subscriptions.length).toBe(1);
        expect(subscriptions[0].channelId).toBe('ch-1');
        expect(subscriptions[0].unsubscribed).toBe(false);

        // Change the Signal param outside reactive context
        await new Promise<void>(resolve => {
          setTimeout(() => {
            channelSignal.value = 'ch-2';
            resolve();
          }, 10);
        });

        await sleep(100);

        // Re-read to trigger relay re-evaluation
        await fetchQuery(GetChannelItems, { channelId: channelSignal });

        // Old subscription should be torn down
        expect(subscriptions[0].unsubscribed).toBe(true);

        // New subscription should exist with updated params
        expect(subscriptions.length).toBe(2);
        expect(subscriptions[1].channelId).toBe('ch-2');
        expect(subscriptions[1].unsubscribed).toBe(false);
      });
    });

    it('should deliver events on the new subscription after param change', async () => {
      class Item extends Entity {
        __typename = t.typename('StreamNewSubItem');
        id = t.id;
        name = t.string;
      }

      let latestOnEvent: ((event: MutationEvent) => void) | undefined;
      let subscribeCount = 0;

      mockFetch.get('/channels/[channelId]/items', {
        items: [{ __typename: 'StreamNewSubItem', id: '1', name: 'Original' }],
      });

      class GetChannelItems extends RESTQuery {
        params = { channelId: t.id };
        path = `/channels/${this.params.channelId}/items`;
        result = {
          items: t.array(t.entity(Item)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              subscribeCount++;
              latestOnEvent = onEvent;
              return () => {};
            },
          };
        }
      }

      const channelSignal = signal('ch-1');

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetChannelItems, { channelId: channelSignal });
        await relay;

        expect(subscribeCount).toBe(1);
        expect(relay.value!.items[0].name).toBe('Original');

        // Change param
        await new Promise<void>(resolve => {
          setTimeout(() => {
            channelSignal.value = 'ch-2';
            resolve();
          }, 10);
        });

        await sleep(100);
        await fetchQuery(GetChannelItems, { channelId: channelSignal });

        expect(subscribeCount).toBe(2);

        // Send an event on the new subscription
        await sendStreamUpdate(latestOnEvent!, {
          type: 'update',
          typename: 'StreamNewSubItem',
          data: { id: '1', name: 'Updated via new sub' },
        });

        expect(relay.value!.items[0].name).toBe('Updated via new sub');
      });
    });

    it('should have access to this.context inside subscribe', async () => {
      class Post extends Entity {
        __typename = t.typename('StreamCtxPost');
        id = t.id;
        title = t.string;
      }

      let receivedContext: any;

      mockFetch.get('/posts', {
        posts: [{ __typename: 'StreamCtxPost', id: '1', title: 'Post 1' }],
      });

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(t.entity(Post)),
        };

        getConfig() {
          return {
            subscribe: (onEvent: (event: MutationEvent) => void) => {
              receivedContext = this.context;
              return () => {};
            },
          };
        }
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPosts);
        await relay;

        expect(receivedContext).toBeDefined();
        expect(typeof receivedContext.fetch).toBe('function');
      });
    });
  });
});
