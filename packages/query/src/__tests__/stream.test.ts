import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { streamQuery } from '../query.js';
import { sleep, testWithClient } from './utils.js';

/**
 * Stream Query Tests
 *
 * Tests stream subscription, entity updates, merging, and lifecycle.
 */

describe('Stream Query', () => {
  let client: QueryClient;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    client = new QueryClient(store, { fetch: fetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Stream Functionality', () => {
    it('should be awaitable and resolve on first update', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            // Send initial data after a delay
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
                email: 'alice@example.com',
              });
            }, 20);

            return () => {};
          },
        }));

        const relay = streamUser();

        // Stream should start pending
        expect(relay.isPending).toBe(true);
        expect(relay.isSettled).toBe(false);

        // Await the stream - should resolve when first update arrives
        const result = await relay;

        // Should now be resolved
        expect(relay.isPending).toBe(false);
        expect(relay.isResolved).toBe(true);
        expect(relay.isSettled).toBe(true);

        // Result should have the data
        expect(result.name).toBe('Alice');
        expect(result.email).toBe('alice@example.com');

        // relay.value should also have the data
        expect(relay.value).toBe(result);
      });
    });

    it('should subscribe to stream and receive updates', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let unsubscribeCallCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            // Store the callback so we can trigger updates
            updateCallback = onUpdate;

            // Send initial data
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
                email: 'alice@example.com',
              });
            }, 10);

            // Return unsubscribe function
            return () => {
              unsubscribeCallCount++;
            };
          },
        }));

        const relay = streamUser();

        // Activate the relay by accessing isPending
        expect(relay.isPending).toBe(true);

        // Wait for initial update
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(relay.isPending).toBe(false);

        expect(relay.value).toBeDefined();
        expect(relay.value?.name).toBe('Alice');
        expect(relay.value?.email).toBe('alice@example.com');

        // Send an update
        updateCallback!({
          id: '1',
          name: 'Alice Smith',
        });

        // Wait for update to propagate
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify update was merged
        expect(relay.value?.name).toBe('Alice Smith');
        expect(relay.value?.email).toBe('alice@example.com'); // Should remain unchanged
      });

      // Verify unsubscribe was called
      expect(unsubscribeCallCount).toBe(1);
    });

    it('should merge updates with existing entity', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
        age: t.union(t.number, t.undefined),
      }));

      let updateCallback: ((update: any) => void) | undefined;

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            updateCallback = onUpdate;

            // Send initial complete data
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Bob',
                email: 'bob@example.com',
                age: 30,
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Initial values
        expect(relay.value?.name).toBe('Bob');
        expect(relay.value?.email).toBe('bob@example.com');
        expect(relay.value?.age).toBe(30);

        // Send complete update with changed age
        updateCallback!({
          __typename: 'User',
          id: '1',
          name: 'Bob',
          email: 'bob@example.com',
          age: 31,
        });
        await new Promise(resolve => setTimeout(resolve, 10));

        // Age should be updated
        expect(relay.value?.name).toBe('Bob');
        expect(relay.value?.email).toBe('bob@example.com');
        expect(relay.value?.age).toBe(31);

        // Send another complete update with changed name
        updateCallback!({
          __typename: 'User',
          id: '1',
          name: 'Robert',
          email: 'bob@example.com',
          age: 31,
        });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(relay.value?.name).toBe('Robert');
        expect(relay.value?.email).toBe('bob@example.com');
        expect(relay.value?.age).toBe(31);
      });
    });

    it('should handle stream with params', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let receivedParams: any;

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          params: { userId: t.string },
          response: User,
          subscribe: (params, onUpdate) => {
            receivedParams = params;

            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: params.userId,
                name: `User ${params.userId}`,
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser({ userId: '42' });
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(receivedParams.userId).toBe('42');
        expect(relay.value?.id).toBe('42');
        expect(relay.value?.name).toBe('User 42');
      });
    });
  });

  describe('Stream Lifecycle', () => {
    it('should unsubscribe when no active subscribers', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            subscribeCount++;

            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {
              unsubscribeCount++;
            };
          },
        }));

        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(subscribeCount).toBe(1);
        expect(unsubscribeCount).toBe(0);
      });

      // After testWithClient exits, should unsubscribe
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(unsubscribeCount).toBe(1);
    });

    it('should reuse subscription for same query', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            subscribeCount++;

            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        // Call the same stream twice
        const relay1 = streamUser();
        const relay2 = streamUser();

        // Activate both relays
        expect(relay1.isPending).toBe(true);
        expect(relay2.isPending).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 50));

        // Should only subscribe once
        expect(subscribeCount).toBe(1);

        // Both should have the same value
        expect(relay1.value).toBe(relay2.value);
        expect(relay1).toBe(relay2);
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error when calling refetch on stream', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Calling refetch should throw
        expect(() => (relay as any).refetch()).toThrow('Cannot refetch a stream query');
      });
    });

    it('should throw error when calling fetchNextPage on stream', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser() as any;
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Calling fetchNextPage should throw
        expect(() => relay.fetchNextPage()).toThrow('Cannot fetch next page on a stream query');
      });
    });

    it('should throw error when response is not an EntityDef', async () => {
      await testWithClient(client, async () => {
        const badStream = (streamQuery as any)(() => ({
          response: t.object({
            name: t.string,
          }) as any,
          subscribe: () => () => {},
        }));

        // Calling the stream function should trigger validation
        expect(() => {
          const relay = badStream() as any;
          // Activate to trigger initialization
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          relay.isPending as any;
        }).toThrow('Stream query response must be an EntityDef');
      });
    });
  });

  describe('Stream Properties', () => {
    it('should have isFetching false after initial update', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Stream should not be fetching
        expect(relay.isFetching).toBe(false);
      });
    });

    it('should have isPaused false for streams', async () => {
      const User = entity(() => ({
        __typename: 'User',
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Streams are never paused
        expect(relay.isPaused).toBe(false);
      });
    });

    it('should have isStale false for streams', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser() as any;
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Streams are never stale
        expect(relay.isStale).toBe(false);
      });
    });

    it('should have hasNextPage false for streams', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: 'Alice',
              });
            }, 10);

            return () => {};
          },
        }));

        const relay = streamUser() as any;
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        // Streams don't have pagination
        expect(relay.hasNextPage).toBe(false);
      });
    });
  });

  describe('Multiple Simultaneous Subscriptions', () => {
    it('should handle multiple streams with different params', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const subscriptions = new Map<string, (update: any) => void>();

      await testWithClient(client, async () => {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          params: { userId: t.string },
          response: User,
          subscribe: (params, onUpdate) => {
            subscriptions.set(params.userId, onUpdate);

            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: params.userId,
                name: `User ${params.userId}`,
              });
            }, 10);

            return () => {
              subscriptions.delete(params.userId);
            };
          },
        }));

        const relay1 = streamUser({ userId: '1' });
        const relay2 = streamUser({ userId: '2' });

        // Activate both relays
        expect(relay1.isPending).toBe(true);
        expect(relay2.isPending).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 50));

        // Both should have their own data
        expect(relay1.value?.id).toBe('1');
        expect(relay1.value?.name).toBe('User 1');
        expect(relay2.value?.id).toBe('2');
        expect(relay2.value?.name).toBe('User 2');

        // Update user 1
        subscriptions.get('1')!({ id: '1', name: 'Updated User 1' });
        await new Promise(resolve => setTimeout(resolve, 10));

        // Only relay1 should be updated
        expect(relay1.value?.name).toBe('Updated User 1');
        expect(relay2.value?.name).toBe('User 2');
      });
    });
  });

  describe('Caching and GC', () => {
    it('should cache stream data and restore on resubscribe', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          subscribeCount++;

          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: `Alice ${subscribeCount}`,
            });
          }, 10);

          return () => {};
        },
        cache: {
          gcTime: 60000, // 1 minute
        },
      }));

      // First subscription
      await testWithClient(client, async () => {
        const relay = streamUser();
        // Activate the relay
        expect(relay.isPending).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(relay.value?.name).toBe('Alice 1');
      });

      // After testWithClient exits, wait a bit but not long enough for gc
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second subscription - should have cached data
      await testWithClient(client, async () => {
        const relay = streamUser();
        // Activate the relay
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        relay.isPending;

        // The cached value should be available, but might be immediately replaced by new subscription
        // Wait for subscription to complete
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(relay.value).toBeDefined();
        // Should have updated value from new subscription
        expect(relay.value?.name).toBe('Alice 2');
      });

      expect(subscribeCount).toBe(2);
    });

    it('should clear cache after gcTime and await first result - same client', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;

      // Create client with short eviction multiplier for faster testing
      const testClient = new QueryClient(store, { fetch: fetch as any, evictionMultiplier: 0.001 });

      try {
        const streamUser = streamQuery(() => ({
          id: 'user-stream',
          response: User,
          subscribe: (params, onUpdate) => {
            subscribeCount++;

            setTimeout(() => {
              onUpdate({
                __typename: 'User',
                id: '1',
                name: `User ${subscribeCount}`,
              });
            }, 20);

            return () => {};
          },
          cache: {
            gcTime: 100, // Very short gc time
          },
        }));

        // First subscription
        await testWithClient(testClient, async () => {
          const relay = streamUser();
          const result = await relay;
          expect(result.name).toBe('User 1');
        });

        // Wait for memory eviction (gcTime + eviction interval buffer)
        // With evictionMultiplier of 0.01, the eviction interval is 600ms
        await new Promise(resolve => setTimeout(resolve, 700));

        // Second subscription after gc - should NOT have cached data in memory
        await testWithClient(testClient, async () => {
          const relay = streamUser();

          // Should start pending since memory cache was cleared
          expect(relay.isPending).toBe(true);
          expect(relay.value).toBeUndefined();

          // Await should wait for first update from new subscription
          const result = await relay;

          expect(relay.isPending).toBe(false);
          expect(result.name).toBe('User 2');
        });

        expect(subscribeCount).toBe(2);
      } finally {
        testClient.destroy();
      }
    });

    it('should await first result in new client instead of using disk cache', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        timestamp: t.string,
      }));

      let subscribeCount = 0;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          subscribeCount++;

          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
              timestamp: `${Date.now()}-${subscribeCount}`,
            });
          }, 20);

          return () => {};
        },
        cache: {
          gcTime: 0,
        },
      }));

      // First client and subscription
      await testWithClient(client, async () => {
        const relay = streamUser();
        const result = await relay;

        expect(result.name).toBe('Alice');
        expect(result.timestamp).toContain('-1');
      });

      // Destroy first client
      client.destroy();

      await sleep(10);

      // Create new client with same store (simulating app restart)
      const client2 = new QueryClient(store, { fetch: fetch as any });

      try {
        // New client should await first stream result
        await testWithClient(client2, async () => {
          const relay = streamUser();

          // Should start pending in new client
          expect(relay.isPending).toBe(true);

          // Await should wait for first update from new subscription
          const result = await relay;

          expect(relay.isPending).toBe(false);
          expect(result.name).toBe('Alice');
          // Should have new timestamp from new subscription
          expect(result.timestamp).toContain('-2');
        });

        expect(subscribeCount).toBe(2);
      } finally {
        client2.destroy();
      }
    });
  });
});
