import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { watcher, reactive } from 'signalium';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Signalium Reactivity Tests
 *
 * Tests relay lifecycle, reactive computations, watcher behavior,
 * and entity update propagation.
 */

describe('Signalium Reactivity', () => {
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

  describe('Relay Lifecycle', () => {
    it('should start relay in pending state', async () => {
      mockFetch.get('/item', { data: 'test' }, { delay: 100 });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);

        // Relay should exist and be in pending state
        expect(relay).toBeDefined();
        expect(relay.isPending).toBe(true);
      });
    });

    it('should transition to resolved state with data', async () => {
      mockFetch.get('/item', { data: 'test' });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);
        await relay;

        expect(relay.isResolved).toBe(true);
        expect(relay.isReady).toBe(true);
        expect(relay.isPending).toBe(false);
        expect(relay.value!).toMatchObject({ data: 'test' });
      });
    });

    it('should transition to error state on failure', async () => {
      const error = new Error('Failed to fetch');
      mockFetch.get('/item', null, { error });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);
        await expect(relay).rejects.toThrow('Failed to fetch');

        expect(relay.isRejected).toBe(true);
        expect(relay.error).toBe(error);
      });
    });
  });

  describe('Reactive Computations', () => {
    it('should support reactive functions depending on query relay', async () => {
      mockFetch.get('/counter', { count: 5 });

      await testWithClient(client, async () => {
        class GetCounter extends RESTQuery {
          path = '/counter';
          result = { count: t.number };
        }

        const relay = fetchQuery(GetCounter);

        // Create a reactive function that depends on the relay
        const doubled = reactive(() => {
          if (relay.isReady) {
            return relay.value.count * 2;
          }
          return 0;
        });

        await relay;

        // Wait for reactive computation
        const result = doubled();

        expect(result).toBe(10);
      });
    });

    it('should support nested reactive functions', async () => {
      mockFetch.get('/value', { value: 10 });

      await testWithClient(client, async () => {
        class GetValue extends RESTQuery {
          path = '/value';
          result = { value: t.number };
        }

        const relay = fetchQuery(GetValue);

        const doubled = reactive(() => {
          if (relay.isReady) {
            return relay.value.value * 2;
          }
          return 0;
        });

        const tripled = reactive(() => {
          return doubled() * 1.5;
        });

        await relay;

        expect(doubled()).toBe(20);
        expect(tripled()).toBe(30);
      });
    });

    it('should support conditional reactivity', async () => {
      mockFetch.get('/config', { value: 5, shouldDouble: true });

      await testWithClient(client, async () => {
        class GetConfig extends RESTQuery {
          path = '/config';
          result = { value: t.number, shouldDouble: t.boolean };
        }

        const relay = fetchQuery(GetConfig);

        const computed = reactive(() => {
          if (relay.isReady) {
            const config = relay.value;
            return config.shouldDouble ? config.value * 2 : config.value;
          }
          return 0;
        });

        await relay;

        expect(computed()).toBe(10);
      });
    });
  });

  describe('Promise State Tracking', () => {
    it('should track isPending state', async () => {
      mockFetch.get('/item', { data: 'test' }, { delay: 50 });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);

        // Initially should be pending
        expect(relay.isPending).toBe(true);

        await relay;

        // After resolution should not be pending
        expect(relay.isPending).toBe(false);
        expect(relay.isSettled).toBe(true);
      });
    });

    it('should track isReady state correctly', async () => {
      mockFetch.get('/item', { data: 'test' });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);

        await relay;

        // After resolution should be ready
        expect(relay.isReady).toBe(true);
        expect(relay.value!).toMatchObject({ data: 'test' });
      });
    });

    it('should track isResolved state', async () => {
      mockFetch.get('/item', { success: true });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { success: t.boolean };
        }

        const relay = fetchQuery(GetItem);
        await relay;

        expect(relay.isResolved).toBe(true);
        expect(relay.isRejected).toBe(false);
      });
    });

    it('should track isRejected state', async () => {
      mockFetch.get('/item', null, { error: new Error('Failed') });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { success: t.boolean };
        }

        const relay = fetchQuery(GetItem);
        await expect(relay).rejects.toThrow('Failed');

        expect(relay.isRejected).toBe(true);
        expect(relay.isResolved).toBe(false);
      });
    });
  });

  describe('Reactive Query Patterns', () => {
    it('should support query results in reactive computations', async () => {
      mockFetch.get('/users', {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      });

      await testWithClient(client, async () => {
        class GetUsers extends RESTQuery {
          path = '/users';
          result = {
            users: t.array(t.object({ id: t.number, name: t.string })),
          };
        }

        const relay = fetchQuery(GetUsers);

        const userCount = reactive(() => {
          if (relay.isReady) {
            return relay.value.users.length;
          }
          return 0;
        });

        const firstUserName = reactive(() => {
          if (relay.isReady && relay.value.users.length > 0) {
            return relay.value.users[0].name;
          }
          return 'Unknown';
        });

        await relay;

        expect(userCount()).toBe(2);
        expect(firstUserName()).toBe('Alice');
      });
    });

    it('should handle conditional query access', async () => {
      mockFetch.get('/config', { enabled: true, data: 'test' });

      await testWithClient(client, async () => {
        class GetConfig extends RESTQuery {
          path = '/config';
          result = { enabled: t.boolean, data: t.string };
        }

        const relay = fetchQuery(GetConfig);

        const result = reactive(() => {
          if (relay.isReady) {
            const config = relay.value;
            return config.enabled ? config.data : 'disabled';
          }
          return 'loading';
        });

        expect(result()).toBe('loading');

        await relay;

        expect(result()).toBe('test');
      });
    });
  });

  describe('Concurrent Query Handling', () => {
    it('should handle concurrent queries without interference', async () => {
      // Set up mocks for different IDs
      mockFetch.get('/items/1', { url: '/items/1', timestamp: Date.now() });
      mockFetch.get('/items/2', { url: '/items/2', timestamp: Date.now() });
      mockFetch.get('/items/3', { url: '/items/3', timestamp: Date.now() });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          params = { id: t.id };
          path = `/items/${this.params.id}`;
          result = { url: t.string, timestamp: t.number };
        }

        // Start multiple concurrent queries
        const relay1 = fetchQuery(GetItem, { id: '1' });
        const relay2 = fetchQuery(GetItem, { id: '2' });
        const relay3 = fetchQuery(GetItem, { id: '3' });

        const [result1, result2, result3] = await Promise.all([relay1, relay2, relay3]);

        expect(result1.url).toContain('/items/1');
        expect(result2.url).toContain('/items/2');
        expect(result3.url).toContain('/items/3');
      });
    });

    it('should deduplicate concurrent identical requests', async () => {
      // Set up single mock with delay - should only be called once
      mockFetch.get('/item', { count: 1 }, { delay: 50 });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { count: t.number };
        }

        // Start multiple concurrent identical requests
        const relay1 = fetchQuery(GetItem);
        const relay2 = fetchQuery(GetItem);
        const relay3 = fetchQuery(GetItem);

        // Should be same relay
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        const [result1, result2, result3] = await Promise.all([relay1, relay2, relay3]);

        // Should only fetch once
        expect(mockFetch.calls).toHaveLength(1);

        // All should have same result
        expect(result1).toEqual(result2);
        expect(result2).toEqual(result3);
      });
    });
  });

  describe('Error State Reactivity', () => {
    it('should notify watchers on error', async () => {
      const error = new Error('Network error');
      mockFetch.get('/item', null, { error });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);
        let errorCaught = false;

        const w = watcher(() => {
          if (relay.isRejected) {
            errorCaught = true;
          }
        });

        const unsub = w.addListener(() => {});

        await expect(relay).rejects.toThrow('Network error');
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(errorCaught).toBe(true);

        unsub();
      });
    });

    it('should expose error object on relay', async () => {
      const error = new Error('Custom error');
      mockFetch.get('/item', null, { error });

      await testWithClient(client, async () => {
        class GetItem extends RESTQuery {
          path = '/item';
          result = { data: t.string };
        }

        const relay = fetchQuery(GetItem);
        await expect(relay).rejects.toThrow('Custom error');

        expect(relay.error).toBe(error);
      });
    });
  });
});
