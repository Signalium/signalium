import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive, signal } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, sendStreamUpdate, sleep, testWithClient } from './utils.js';
import type { MutationEvent } from '../types.js';

/**
 * Entity Subscribe Tests
 *
 * Tests entity subscription functionality including activation, deactivation,
 * updates via MutationEvent, and integration with queries.
 */

describe('Entity Subscribe', () => {
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

  describe('Basic Subscribe', () => {
    it('should receive updates when entity is accessed reactively', async () => {
      let streamCallback: ((event: MutationEvent) => void) | undefined;
      let unsubscribeCallCount = 0;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
        __subscribe(onEvent: any) {
          streamCallback = onEvent;
          return () => {
            unsubscribeCallCount++;
          };
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);

        expect(userName()).toBe('Alice');

        await sleep(20);
        expect(streamCallback).toBeDefined();
        expect(unsubscribeCallCount).toBe(0);

        await sendStreamUpdate(streamCallback, {
          type: 'update',
          typename: 'User',
          data: { id: '1', name: 'Alice Updated' },
        });

        await sleep(20);

        expect(userName()).toBe('Alice Updated');
        expect(user.email).toBe('alice@example.com');
      });

      await sleep(50);
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });

    it('should only activate subscribe when entity signal is accessed', async () => {
      let streamActivated = false;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          streamActivated = true;
          return () => {
            streamActivated = false;
          };
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const { user } = await fetchQuery(GetUser, { id: '1' });

        expect(streamActivated).toBe(false);

        expect(user.name).toBe('Alice');

        expect(streamActivated).toBe(true);
      });
    });

    it('should subscribe and unsubscribe dynamically based on usage', async () => {
      let streamActivated = false;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          streamActivated = true;
          return () => {
            streamActivated = false;
          };
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const shouldGetUser = signal(false);

      const maybeGetUser = reactive(async () => {
        return shouldGetUser.value ? (await fetchQuery(GetUser, { id: '1' })).user.name : { user: undefined };
      });

      await testWithClient(client, async () => {
        await maybeGetUser();

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
        await sleep();

        expect(streamActivated).toBe(false);
      });
    });

    it('should unsubscribe when entity is no longer watched', async () => {
      let unsubscribeCallCount = 0;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          return () => {
            unsubscribeCallCount++;
          };
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');
      });

      await sleep(50);
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });
  });

  describe('Updates via MutationEvent', () => {
    it('should update entity when subscription sends update event', async () => {
      let streamCallback: ((event: MutationEvent) => void) | undefined;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
        age = t.number;
        __subscribe(onEvent: any) {
          streamCallback = onEvent;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

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
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        const userAge = reactive(() => user.age);

        expect(userName()).toBe('Alice');
        expect(userAge()).toBe(30);

        await sleep(20);
        expect(streamCallback).toBeDefined();

        await sendStreamUpdate(streamCallback, {
          type: 'update',
          typename: 'User',
          data: { id: '1', name: 'Alice Updated' },
        });

        await sleep(20);

        expect(userName()).toBe('Alice Updated');
        expect(userAge()).toBe(30);
        expect(user.email).toBe('alice@example.com');
      });
    });

    it('should handle multiple rapid update events correctly', async () => {
      let streamCallback: ((event: MutationEvent) => void) | undefined;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        count = t.number;
        __subscribe(onEvent: any) {
          streamCallback = onEvent;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          count: 0,
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const userCount = reactive(() => user.count);
        expect(userCount()).toBe(0);

        await sleep(20);
        expect(streamCallback).toBeDefined();

        await sendStreamUpdate(streamCallback, { type: 'update', typename: 'User', data: { id: '1', count: 1 } });
        await sendStreamUpdate(streamCallback, { type: 'update', typename: 'User', data: { id: '1', count: 2 } });
        await sendStreamUpdate(streamCallback, { type: 'update', typename: 'User', data: { id: '1', count: 3 } });

        await sleep(20);

        expect(userCount()).toBe(3);
      });
    });
  });

  describe('Multiple Entities', () => {
    it('should have separate subscriptions for different entity instances', async () => {
      let streamCallbacks: Map<string, (event: MutationEvent) => void> = new Map();

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          streamCallbacks.set(String(this.id), onEvent);
          return () => {
            streamCallbacks.delete(String(this.id));
          };
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

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
        const relay1 = fetchQuery(GetUser, { id: '1' });
        const relay2 = fetchQuery(GetUser, { id: '2' });

        await Promise.all([relay1, relay2]);

        const user1 = relay1.value!.user;
        const user2 = relay2.value!.user;

        const name1 = reactive(() => user1.name);
        const name2 = reactive(() => user2.name);

        expect(name1()).toBe('User 1');
        expect(name2()).toBe('User 2');

        await sleep(20);

        await sendStreamUpdate(streamCallbacks.get('1'), {
          type: 'update',
          typename: 'User',
          data: { id: '1', name: 'Updated User 1' },
        });

        await sleep(20);

        expect(name1()).toBe('Updated User 1');
        expect(name2()).toBe('User 2');
      });
    });
  });

  describe('No Entity Config', () => {
    it('should work normally without subscribe', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;
        expect(user.name).toBe('Alice');

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');
      });
    });
  });

  describe('Entity ID Extraction', () => {
    it('should pass correct entity ID value to subscribe function', async () => {
      let receivedId: string | number | undefined;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          receivedId = this.id as string | number;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '123',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '123' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        await sleep(20);
        expect(receivedId).toBe('123');
      });
    });
  });

  describe('QueryContext', () => {
    it('should receive QueryContext with fetch function', async () => {
      let receivedContext: any;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          receivedContext = (this as any).__context;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        await sleep(20);
        expect(receivedContext).toBeDefined();
        expect(typeof receivedContext.fetch).toBe('function');
      });
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear entity cache on subscription updates', async () => {
      let streamCallback: ((event: MutationEvent) => void) | undefined;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any) {
          streamCallback = onEvent;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        expect(user.name).toBe('Alice');

        await sleep(20);
        expect(streamCallback).toBeDefined();

        await sendStreamUpdate(streamCallback, {
          type: 'update',
          typename: 'User',
          data: { id: '1', name: 'Alice Updated' },
        });

        await sleep(20);

        expect(user.name).toBe('Alice Updated');
      });
    });
  });

  describe('Nested Entity Access', () => {
    it('should activate subscribe when accessing nested properties', async () => {
      let streamActivated = false;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        profile = t.object({
          name: t.string,
          bio: t.string,
        });
        __subscribe(onEvent: any) {
          streamActivated = true;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

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
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const profileName = reactive(() => (user.profile as any).name);
        expect(profileName()).toBe('Alice');

        await sleep(20);
        expect(streamActivated).toBe(true);
      });
    });
  });

  describe('Subscribe Errors', () => {
    it('should handle errors in subscribe function gracefully', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        __subscribe(onEvent: any): (() => void) | undefined {
          throw new Error('Stream error');
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        expect(() => {
          const userName = reactive(() => user.name);
          userName();
        }).toThrow('Stream error');
      });
    });
  });

  describe('Entity Methods', () => {
    it('should work correctly with entity methods', async () => {
      let streamCallback: ((event: MutationEvent) => void) | undefined;

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        firstName = t.string;
        lastName = t.string;
        fullName() {
          return `${this.firstName} ${this.lastName}`;
        }
        __subscribe(onEvent: any) {
          streamCallback = onEvent;
          return () => {};
        }
      }

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = { user: t.entity(User) };
      }

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          firstName: 'Alice',
          lastName: 'Smith',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetUser, { id: '1' });
        await relay;

        const user = relay.value!.user;

        const fullName = reactive(() => user.fullName());
        expect(fullName()).toBe('Alice Smith');

        await sleep(20);
        expect(streamCallback).toBeDefined();

        await sendStreamUpdate(streamCallback, {
          type: 'update',
          typename: 'User',
          data: { id: '1', firstName: 'Bob' },
        });

        await sleep(20);

        expect(fullName()).toBe('Bob Smith');
      });
    });
  });
});
