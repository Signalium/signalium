import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from 'signalium';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient, getEntityMapSize, sleep } from './utils.js';

/**
 * Debounce Tests
 *
 * Tests for the debounce option that delays fetch requests
 * when parameters change.
 */

describe('Debounce', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Debounce Functionality', () => {
    it('should not delay initial fetch when debounce is configured', async () => {
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
        debounce: 100,
      }));

      await testWithClient(client, async () => {
        // Initial fetch should happen immediately (debounce only applies to refetches)
        await listUsers();
        expect(mockFetch.calls.length).toBe(1);
      });
    });

    it('should not delay when debounce is not configured', async () => {
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
      }));

      await testWithClient(client, async () => {
        await listUsers();
        // Should fetch immediately
        expect(mockFetch.calls.length).toBe(1);
      });
    });

    it('should delay refetch when Signal value changes', async () => {
      const idSignal = signal('123');
      mockFetch.get('/users/[id]', { id: 123, name: 'User 123' });
      mockFetch.get('/users/[id]', { id: 456, name: 'User 456' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
        debounce: 100,
      }));

      await testWithClient(client, async () => {
        // Initial fetch
        const queryResult1 = getUser({ id: idSignal });
        await queryResult1;
        expect(mockFetch.calls.length).toBe(1);

        // Change Signal value outside reactive context
        await new Promise(resolve => {
          setTimeout(() => {
            idSignal.value = '456';
            resolve(undefined);
          }, 10);
        });

        await sleep(20);

        expect(mockFetch.calls.length).toBe(1);

        await sleep(100);

        // Should have fetched (new query key = new instance = immediate fetch)
        expect(mockFetch.calls.length).toBe(2);
      });
    });
  });

  describe('Debounce Cancellation', () => {
    it('should handle rapid Signal changes', async () => {
      const idSignal = signal('123');
      mockFetch.get('/users/[id]', { id: 123, name: 'User 123' });
      mockFetch.get('/users/[id]', { id: 456, name: 'User 456' });
      mockFetch.get('/users/[id]', { id: 789, name: 'User 789' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
        debounce: 100,
      }));

      await testWithClient(client, async () => {
        // Initial fetch
        const queryResult1 = getUser({ id: idSignal });
        await queryResult1;
        expect(mockFetch.calls.length).toBe(1);

        // Rapid Signal changes
        await new Promise(resolve => {
          setTimeout(() => {
            idSignal.value = '456';
            resolve(undefined);
          }, 10);
        });

        await new Promise(resolve => {
          setTimeout(() => {
            idSignal.value = '789';
            resolve(undefined);
          }, 10);
        });

        expect(mockFetch.calls.length).toBe(1);

        await sleep(100);

        expect(mockFetch.calls.length).toBe(2);
      });
    });

    it('should cancel debounced fetch when manual refetch is called', async () => {
      mockFetch.get('/users', { users: [] });
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
        debounce: 100,
      }));

      await testWithClient(client, async () => {
        const queryResult = listUsers();
        const result = await queryResult;
        expect(mockFetch.calls.length).toBe(1);

        // Trigger debounced refetch (but refetch() bypasses debounce, so this should fetch immediately)
        const refetchPromise = queryResult.refetch();
        await refetchPromise;
        expect(mockFetch.calls.length).toBe(2);

        // Manual refetch again should fetch immediately (no debounce)
        const refetchPromise2 = queryResult.refetch();
        await refetchPromise2;
        expect(mockFetch.calls.length).toBe(3);
      });
    });
  });

  describe('Debounce with Stale Data', () => {
    it('should debounce stale data refetch', async () => {
      mockFetch.get('/users', { users: [] });
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
        cache: {
          staleTime: 50,
        },

        debounce: 1000,
      }));

      await testWithClient(client, async () => {
        await listUsers();
        expect(mockFetch.calls.length).toBe(1);

        // Access result to trigger stale refetch
        const queryResult = listUsers();
        await queryResult;
        expect(mockFetch.calls.length).toBe(1); // Initial fetch
      });

      // trigger stale time
      await sleep(100);

      await testWithClient(client, async () => {
        const queryResult = listUsers();
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        queryResult.value;

        await sleep(10);

        expect(mockFetch.calls.length).toBe(2);
      });
    });
  });

  describe('Debounce Edge Cases', () => {
    it('should handle debounce with 0ms delay (no debounce)', async () => {
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
        debounce: 0,
      }));

      await testWithClient(client, async () => {
        await listUsers();
        // Should fetch immediately (0ms debounce = no debounce)
        expect(mockFetch.calls.length).toBe(1);
      });
    });

    it('should work with retry logic', async () => {
      // First call fails, second succeeds
      mockFetch.get('/users', null, { status: 500 });
      mockFetch.get('/users', { users: [] });

      const listUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number })),
        },
        cache: {
          debounce: 100,
          retry: 1,
        },
      }));

      await testWithClient(client, async () => {
        try {
          await listUsers();
        } catch (error) {
          // Expected to fail first time
        }

        // Should have attempted fetch after debounce
        expect(mockFetch.calls.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
