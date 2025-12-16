import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive, signal } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, sendStreamUpdate, sleep, testWithClient } from './utils.js';

/**
 * Entity Stream Tests
 *
 * Tests entity streaming functionality including activation, deactivation,
 * updates, and integration with queries.
 */

describe('Entity Streaming', () => {
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

  describe('Basic Streaming', () => {
    it('should receive updates when entity is accessed reactively', async () => {
      let streamCallback: ((update: any) => void) | undefined;
      let unsubscribeCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {
                unsubscribeCallCount++;
              };
            },
          },
        },
      );

      // Create entity via query
      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        // Access user in reactive context to activate stream
        const userName = reactive(() => user.name);

        expect(userName()).toBe('Alice');

        // Wait a bit for relay to activate and stream callback to be set
        await sleep(20);
        expect(streamCallback).toBeDefined();
        expect(unsubscribeCallCount).toBe(0);

        // Send stream update
        await sendStreamUpdate(streamCallback, {
          name: 'Alice Updated',
        });

        // Wait for notifier to propagate and reactive function to re-run
        await sleep(20);

        // User should be updated - need to access again to trigger re-computation
        expect(userName()).toBe('Alice Updated');
        expect(user.email).toBe('alice@example.com'); // Other fields preserved
      });

      // Wait for cleanup
      await sleep(50);
      // Stream should unsubscribe when reactive context ends
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });

    it('should only activate stream when entity signal is accessed', async () => {
      let streamActivated = false;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamActivated = true;
              return () => {
                streamActivated = false;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const { user } = await getUser({ id: '1' });

        // Access user outside reactive context - stream should not activate
        // expect(name).toBe('Alice');
        expect(streamActivated).toBe(false);

        expect(user.name).toBe('Alice');

        // Access in reactive context - stream should activate
        // Wait for relay to activate
        expect(streamActivated).toBe(true);
      });
    });

    it('should subcribe and unsubscribe dynamically based on usage', async () => {
      let streamActivated = false;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamActivated = true;
              return () => {
                streamActivated = false;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const shouldGetUser = signal(false);

      const maybeGetUser = reactive(async () => {
        return shouldGetUser.value ? (await getUser({ id: '1' })).user.name : { user: undefined };
      });

      await testWithClient(client, async () => {
        await maybeGetUser();

        // Access user outside reactive context - stream should not activate
        // expect(name).toBe('Alice');
        expect(streamActivated).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 0)).then(() => {
          shouldGetUser.value = true;
        });

        await maybeGetUser();

        expect(streamActivated).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 0)).then(() => {
          shouldGetUser.value = false;
        });

        await maybeGetUser();
        // Wait an extra tick for the stream to unsubscribe
        await sleep();

        expect(streamActivated).toBe(false);
      });
    });

    it('should unsubscribe when entity is no longer watched', async () => {
      let unsubscribeCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              return () => {
                unsubscribeCallCount++;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        // Create reactive function that watches user
        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        // Reactive function goes out of scope - stream should unsubscribe
        // This happens when testWithClient ends
      });

      // Give time for cleanup
      await sleep(50);
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });
  });

  describe('Partial Updates', () => {
    it('should merge stream updates correctly with existing entity data', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
          age: t.number,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        const userAge = reactive(() => user.age);

        expect(userName()).toBe('Alice');
        expect(userAge()).toBe(30);

        // Wait for stream to activate
        await sleep(20);
        expect(streamCallback).toBeDefined();

        // Send partial update
        await sendStreamUpdate(streamCallback, {
          name: 'Alice Updated',
        });

        // Wait for notifier to propagate
        await sleep(20);

        // Only name should change - access again to trigger re-computation
        expect(userName()).toBe('Alice Updated');
        expect(userAge()).toBe(30);
        expect(user.email).toBe('alice@example.com');
      });
    });

    it('should handle multiple rapid updates correctly', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          count: t.number,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          count: 0,
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        const userCount = reactive(() => user.count);
        expect(userCount()).toBe(0);

        // Wait for stream to activate
        await sleep(20);
        expect(streamCallback).toBeDefined();

        // Send multiple rapid updates
        await sendStreamUpdate(streamCallback, { count: 1 });
        await sendStreamUpdate(streamCallback, { count: 2 });
        await sendStreamUpdate(streamCallback, { count: 3 });

        // Wait for notifier to propagate
        await sleep(20);

        // Should have final value - access again to trigger re-computation
        expect(userCount()).toBe(3);
      });
    });
  });

  describe('Multiple Entities', () => {
    it('should have separate streams for different entity instances', async () => {
      let streamCallbacks: Map<string, (update: any) => void> = new Map();

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallbacks.set(String(id), onUpdate);
              return () => {
                streamCallbacks.delete(String(id));
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'User 1',
        },
      });
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '2',
          name: 'User 2',
        },
      });

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '1' });
        const relay2 = getUser({ id: '2' });

        await Promise.all([relay1, relay2]);

        const user1 = relay1.value!.user;
        const user2 = relay2.value!.user;

        const name1 = reactive(() => user1.name);
        const name2 = reactive(() => user2.name);

        expect(name1()).toBe('User 1');
        expect(name2()).toBe('User 2');

        // Wait for streams to activate
        await sleep(20);

        // Update user1
        await sendStreamUpdate(streamCallbacks.get('1'), { name: 'Updated User 1' });

        // Wait for notifier to propagate
        await sleep(20);

        expect(name1()).toBe('Updated User 1');
        expect(name2()).toBe('User 2'); // user2 should not be affected
      });
    });
  });

  describe('No Entity Config', () => {
    it('should work normally without entity config', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;
        expect(user.name).toBe('Alice');

        // Should work normally without stream
        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');
      });
    });
  });

  describe('Entity ID Extraction', () => {
    it('should pass correct entity ID value to stream function', async () => {
      let receivedId: string | number | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              receivedId = id;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '123',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '123' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        // Wait for stream to activate
        await sleep(20);
        expect(receivedId).toBe('123');
      });
    });
  });

  describe('QueryContext', () => {
    it('should receive QueryContext with fetch function', async () => {
      let receivedContext: any;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              receivedContext = context;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        // Wait for stream to activate
        await sleep(20);
        expect(receivedContext).toBeDefined();
        expect(typeof receivedContext.fetch).toBe('function');
      });
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear entity cache on stream updates', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        // Access name to populate cache
        expect(user.name).toBe('Alice');

        // Wait for stream to activate
        await sleep(20);
        expect(streamCallback).toBeDefined();

        // Update via stream
        await sendStreamUpdate(streamCallback, {
          name: 'Alice Updated',
        });

        // Wait for notifier to propagate
        await sleep(20);

        // Cache should be cleared and new value should be available
        expect(user.name).toBe('Alice Updated');
      });
    });
  });

  describe('Nested Entity Access', () => {
    it('should activate stream when accessing nested properties', async () => {
      let streamActivated = false;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          profile: t.object({
            name: t.string,
            bio: t.string,
          }),
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamActivated = true;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          profile: {
            name: 'Alice',
            bio: 'Bio',
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        // Access nested property in reactive context
        const profileName = reactive(() => user.profile.name);
        expect(profileName()).toBe('Alice');

        // Wait for stream to activate
        await sleep(20);
        expect(streamActivated).toBe(true);
      });
    });
  });

  describe('Stream Errors', () => {
    it('should handle errors in stream function gracefully', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              throw new Error('Stream error');
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        // Accessing in reactive context should throw error
        expect(() => {
          const userName = reactive(() => user.name);
          userName();
        }).toThrow('Stream error');
      });
    });
  });

  describe('Entity Methods', () => {
    it('should work correctly with entity methods', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
        }),
        () => ({
          fullName() {
            return `${this.firstName} ${this.lastName}`;
          },
        }),
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          firstName: 'Alice',
          lastName: 'Smith',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        const fullName = reactive(() => user.fullName());
        expect(fullName()).toBe('Alice Smith');

        // Wait for stream to activate
        await sleep(20);
        expect(streamCallback).toBeDefined();

        // Update via stream
        await sendStreamUpdate(streamCallback, {
          firstName: 'Bob',
        });

        // Wait for notifier to propagate
        await sleep(20);

        // Method should reflect updated data - access again to trigger re-computation
        expect(fullName()).toBe('Bob Smith');
      });
    });
  });

  describe('Extended Entities', () => {
    it('should preserve entity config when extending', async () => {
      let streamActivated = false;

      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamActivated = true;
              return () => {};
            },
          },
        },
      );

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
      }));

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: ExtendedUser },
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        // Wait for stream to activate
        await sleep(20);
        expect(streamActivated).toBe(true);
      });
    });
  });
});
