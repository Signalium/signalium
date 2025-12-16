import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientContext } from '../QueryClient.js';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { query } from '../query.js';
import { NetworkManager } from '../NetworkManager.js';
import { NetworkMode } from '../types.js';
import { createMockFetch, testWithClient, sleep, createTestWatcher } from './utils.js';
import { t } from '../typeDefs.js';
import { withContexts } from 'signalium';

describe('Network Mode', () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  let store: SyncQueryStore;
  let networkManager: NetworkManager;
  let client: QueryClient;

  beforeEach(() => {
    mockFetch = createMockFetch();
    store = new SyncQueryStore(new MemoryPersistentStore());
    // Start with online status
    networkManager = new NetworkManager(true);
    client = new QueryClient(store, { fetch: mockFetch as any }, networkManager);
  });

  afterEach(() => {
    client.destroy();
  });

  describe('NetworkMode.Online (default)', () => {
    it('should fetch when online', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(result.isPaused).toBe(false);
      });
    });

    it('should pause and not fetch when offline', async () => {
      // Set network to offline
      networkManager.setNetworkStatus(false);

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.Online },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        expect(result.isPaused).toBe(true);
        expect(result.isPending).toBe(true);

        // Should not have made any fetch calls
        expect(mockFetch.calls.length).toBe(0);
      });
    });

    it('should retry when coming back online', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          networkMode: NetworkMode.Online,
          staleTime: 0, // Always stale
          refreshStaleOnReconnect: true,
        },
      }));

      // Create a test watcher to keep the query active
      const { unsub } = withContexts([[QueryClientContext, client]], () =>
        createTestWatcher(() => {
          const result = getUser();
          return result.value;
        }),
      );

      // Wait for initial fetch
      await sleep(50);
      expect(mockFetch.calls.length).toBe(1);

      // Now go offline then online to trigger refetch
      networkManager.setNetworkStatus(false);
      await sleep(10);
      networkManager.setNetworkStatus(true);

      // Wait for refetch to complete
      await sleep(150);

      // Should have made 2 fetch calls
      expect(mockFetch.calls.length).toBe(2);

      unsub();
    });
  });

  describe('NetworkMode.Always', () => {
    it('should fetch even when offline', async () => {
      // Set network to offline
      networkManager.setNetworkStatus(false);

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.Always },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        expect(result.isPaused).toBe(false);
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);
      });
    });

    it('should never be paused', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.Always },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        expect(result.isPaused).toBe(false);

        // Go offline
        networkManager.setNetworkStatus(false);
        expect(result.isPaused).toBe(false);

        // Go back online
        networkManager.setNetworkStatus(true);
        expect(result.isPaused).toBe(false);
      });
    });
  });

  describe('NetworkMode.OfflineFirst', () => {
    it('should fetch when online and no cache', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.OfflineFirst },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        expect(result.isPaused).toBe(false);
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);
      });
    });

    it('should pause when offline and no cache', async () => {
      // Set network to offline
      networkManager.setNetworkStatus(false);

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.OfflineFirst },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        expect(result.isPaused).toBe(true);
        expect(mockFetch.calls.length).toBe(0);
      });
    });

    it('should NOT pause when offline if cache exists', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          networkMode: NetworkMode.OfflineFirst,
          staleTime: 0, // Always stale so we try to refetch
        },
      }));

      await testWithClient(client, async () => {
        // First fetch while online
        const result = getUser();
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);

        // Now go offline
        networkManager.setNetworkStatus(false);

        // Query should not be paused because we have cached data
        expect(result.isPaused).toBe(false);

        // Even though stale, should not fetch because offline
        await sleep(50);
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);
      });
    });
  });

  describe('refreshStaleOnReconnect', () => {
    it('should refetch stale queries when reconnecting (default true)', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          staleTime: 0, // Always stale
          // refreshStaleOnReconnect defaults to true
        },
      }));

      await testWithClient(client, async () => {
        // First fetch while online
        const result = getUser();
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);

        // Go offline
        networkManager.setNetworkStatus(false);
        await sleep(50);

        // Go back online
        networkManager.setNetworkStatus(true);
        await sleep(100);

        // Should have refetched
        expect(mockFetch.calls.length).toBe(2);
        await sleep(50);
        expect(result.value).toEqual({ id: '1', name: 'Alice Updated' });
      });
    });

    it('should NOT refetch when refreshStaleOnReconnect is false', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          staleTime: 0, // Always stale
          refreshStaleOnReconnect: false,
        },
      }));

      await testWithClient(client, async () => {
        // First fetch while online
        const result = getUser();
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);

        // Go offline
        networkManager.setNetworkStatus(false);
        await sleep(50);

        // Go back online
        networkManager.setNetworkStatus(true);
        await sleep(100);

        // Should NOT have refetched
        expect(mockFetch.calls.length).toBe(1);
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
      });
    });

    it('should NOT refetch non-stale queries on reconnect', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          staleTime: 60000, // 1 minute - won't be stale
          refreshStaleOnReconnect: true,
        },
      }));

      await testWithClient(client, async () => {
        // First fetch while online
        const result = getUser();
        await result;
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
        expect(mockFetch.calls.length).toBe(1);

        // Go offline
        networkManager.setNetworkStatus(false);
        await sleep(50);

        // Go back online
        networkManager.setNetworkStatus(true);
        await sleep(100);

        // Should NOT have refetched because data is not stale
        expect(mockFetch.calls.length).toBe(1);
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
      });
    });
  });

  describe('Retry Logic', () => {
    it('should retry 3 times by default on client', async () => {
      let attempts = 0;

      // Add multiple mock responses that will fail, then succeed
      for (let i = 0; i < 3; i++) {
        mockFetch.get('/users/1', () => {
          attempts++;
          throw new Error('Network error');
        });
      }
      mockFetch.get('/users/1', () => {
        attempts++;
        return { id: '1', name: 'Alice' };
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          retry: {
            retries: 3,
            retryDelay: () => 10, // Short delay for faster tests
          },
        },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;

        // Should have tried 4 times total (1 initial + 3 retries)
        expect(attempts).toBe(4);
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
      });
    });

    it('should not retry on server by default', async () => {
      // Create a server-side client
      const serverStore = new SyncQueryStore(new MemoryPersistentStore());
      const serverNetworkManager = new NetworkManager(true);

      // Mock window being undefined to simulate server
      const originalWindow = global.window;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      delete global.window;

      const serverClient = new QueryClient(serverStore, { fetch: mockFetch as any }, serverNetworkManager);

      let attempts = 0;
      mockFetch.get('/users/1', () => {
        attempts++;
        throw new Error('Network error');
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
      }));

      await testWithClient(serverClient, async () => {
        const result = getUser();

        try {
          await result;
        } catch (e) {
          // Expected to fail
        }

        // Should have tried only once (no retries on server)
        expect(attempts).toBe(1);
      });

      // Restore window
      global.window = originalWindow;
      serverClient.destroy();
    });

    it('should respect custom retry count', async () => {
      let attempts = 0;

      // Add multiple mock responses that will fail, then succeed
      for (let i = 0; i < 5; i++) {
        mockFetch.get('/users/1', () => {
          attempts++;
          throw new Error('Network error');
        });
      }
      mockFetch.get('/users/1', () => {
        attempts++;
        return { id: '1', name: 'Alice' };
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          retry: {
            retries: 5,
            retryDelay: () => 10, // Short delay for faster tests
          },
        },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;

        // Should have tried 6 times total (1 initial + 5 retries)
        expect(attempts).toBe(6);
        expect(result.value).toEqual({ id: '1', name: 'Alice' });
      });
    });

    it('should not retry when retry is false', async () => {
      let attempts = 0;
      mockFetch.get('/users/1', () => {
        attempts++;
        throw new Error('Network error');
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { retry: false },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        try {
          await result;
        } catch (e) {
          // Expected to fail
        }

        // Should have tried only once
        expect(attempts).toBe(1);
      });
    });

    it('should use custom retry delay', async () => {
      const delays: number[] = [];
      let attempts = 0;

      mockFetch.get('/users/1', () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return { id: '1', name: 'Alice' };
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          retry: {
            retries: 2,
            retryDelay: attempt => {
              const delay = 100 * (attempt + 1); // 100ms, 200ms
              delays.push(delay);
              return delay;
            },
          },
        },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;

        expect(attempts).toBe(3);
        expect(delays).toEqual([100, 200]);
      });
    });

    it('should stop retrying when network goes offline', async () => {
      let attempts = 0;

      mockFetch.get('/users/1', async () => {
        attempts++;
        if (attempts === 2) {
          // Go offline during retry
          networkManager.setNetworkStatus(false);
        }
        throw new Error('Network error');
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          retry: {
            retries: 5,
            retryDelay: () => 10, // Short delay for faster test
          },
        },
      }));

      await testWithClient(client, async () => {
        const result = getUser();

        try {
          await result;
        } catch (e) {
          // Expected to fail
        }

        // Should have stopped retrying after going offline
        expect(attempts).toBeLessThan(6);
      });
    });

    it('should reset attempt count on successful fetch', async () => {
      let attempts = 0;

      // First call fails
      mockFetch.get('/users/1', () => {
        attempts++;
        throw new Error('Network error');
      });
      // Second call succeeds
      mockFetch.get('/users/1', () => {
        attempts++;
        return { id: '1', name: 'Alice' };
      });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: {
          retry: {
            retries: 3,
            retryDelay: () => 10,
          },
          staleTime: 0, // Always stale
        },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;

        // First fetch: 1 failure + 1 retry success = 2 attempts
        expect(attempts).toBe(2);

        // Refetch - should start fresh
        attempts = 0;
        mockFetch.get('/users/1', () => {
          attempts++;
          return { id: '1', name: 'Alice Updated' };
        });

        await result.refetch();

        // Should have made 1 attempt (not continuing from previous count)
        expect(attempts).toBe(1);
      });
    });
  });

  describe('isPaused reactivity', () => {
    it('should correctly report isPaused based on network status', async () => {
      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/users/1',
        response: t.object({ id: t.string, name: t.string }),
        cache: { networkMode: NetworkMode.Online },
      }));

      await testWithClient(client, async () => {
        const result = getUser();
        await result;

        // Check initial state
        expect(result.isPaused).toBe(false);
      });

      // Go offline and check in new reactive context
      networkManager.setNetworkStatus(false);

      await testWithClient(client, async () => {
        const result = getUser();
        expect(result.isPaused).toBe(true);
      });

      // Go back online and check in new reactive context
      networkManager.setNetworkStatus(true);

      await testWithClient(client, async () => {
        const result = getUser();
        expect(result.isPaused).toBe(false);
      });
    });
  });
});
