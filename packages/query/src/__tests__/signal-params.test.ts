import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from 'signalium';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Signal Parameter Tests
 *
 * Tests for queries that accept Signal<T> values in parameters,
 * ensuring automatic refetching when signals update.
 */

describe('Signal Parameters', () => {
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

  describe('Basic Signal Support', () => {
    it('should execute a query with Signal in path parameter', async () => {
      const idSignal = signal('123');
      mockFetch.get('/users/[id]', { id: 123, name: 'Test User' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const result = await getUser({ id: idSignal });
        expect(result.id).toBe(123);
        expect(result.name).toBe('Test User');
        expect(mockFetch.calls[0].url).toBe('/users/123');
      });
    });

    it('should execute a query with Signal in search parameter', async () => {
      const pageSignal = signal(1);
      const limitSignal = signal(10);
      mockFetch.get('/users', { users: [], page: 1, total: 0 });

      const listUsers = query(() => ({
        path: '/users',
        searchParams: {
          page: t.number,
          limit: t.number,
        },
        response: {
          users: t.array(
            t.object({
              id: t.number,
              name: t.string,
            }),
          ),
          page: t.number,
          total: t.number,
        },
      }));

      await testWithClient(client, async () => {
        const result = await listUsers({ page: pageSignal, limit: limitSignal });
        expect(result.page).toBe(1);
        expect(mockFetch.calls[0].url).toContain('page=1');
        expect(mockFetch.calls[0].url).toContain('limit=10');
      });
    });

    it('should execute a query with mixed Signal and primitive parameters', async () => {
      const idSignal = signal('456');
      mockFetch.get('/users/[id]/posts', { posts: [] });

      const getUserPosts = query(() => ({
        path: '/users/[id]/posts',
        searchParams: {
          status: t.string,
        },
        response: {
          posts: t.array(
            t.object({
              id: t.number,
              title: t.string,
            }),
          ),
        },
      }));

      await testWithClient(client, async () => {
        const result = await getUserPosts({ id: idSignal, status: 'published' });
        expect(mockFetch.calls[0].url).toContain('/users/456/posts');
        expect(mockFetch.calls[0].url).toContain('status=published');
      });
    });
  });

  describe('Signal Change Triggers Refetch', () => {
    it('should refetch when Signal value changes', async () => {
      const idSignal = signal('123');
      mockFetch.get('/users/[id]', { id: 123, name: 'User 123' });
      mockFetch.get('/users/[id]', { id: 456, name: 'User 456' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const result1 = await getUser({ id: idSignal });
        expect(result1.id).toBe(123);
        expect(result1.name).toBe('User 123');
        expect(mockFetch.calls.length).toBe(1);

        // Change Signal value outside reactive context
        await new Promise(resolve => {
          setTimeout(() => {
            idSignal.value = '456';
            resolve(undefined);
          }, 10);
        });

        // Wait for refetch to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Access result again to trigger reactive update
        const result2 = await getUser({ id: idSignal });
        expect(result2.id).toBe(456);
        expect(result2.name).toBe('User 456');
        expect(mockFetch.calls.length).toBe(2);
      });
    });

    it('should refetch when multiple Signals change', async () => {
      const pageSignal = signal(1);
      const limitSignal = signal(10);
      mockFetch.get('/users', { users: [], page: 1, total: 0 });
      mockFetch.get('/users', { users: [], page: 2, total: 0 });

      const listUsers = query(() => ({
        path: '/users',
        searchParams: {
          page: t.number,
          limit: t.number,
        },
        response: {
          users: t.array(t.object({ id: t.number })),
          page: t.number,
          total: t.number,
        },
      }));

      await testWithClient(client, async () => {
        const result1 = await listUsers({ page: pageSignal, limit: limitSignal });
        expect(result1.page).toBe(1);
        expect(mockFetch.calls.length).toBe(1);

        // Change Signal values outside reactive context
        await new Promise(resolve => {
          setTimeout(() => {
            pageSignal.value = 2;
            resolve(undefined);
          }, 10);
        });

        // Wait for refetch
        await new Promise(resolve => setTimeout(resolve, 100));

        const result2 = await listUsers({ page: pageSignal, limit: limitSignal });
        expect(result2.page).toBe(2);
        expect(mockFetch.calls.length).toBe(2);
      });
    });
  });

  describe('Query Key Computation', () => {
    it('should use same cache for queries with same Signal values', async () => {
      const idSignal1 = signal('123');
      const idSignal2 = signal('123');
      mockFetch.get('/users/[id]', { id: 123, name: 'Test User' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const result1 = await getUser({ id: idSignal1 });
        const result2 = await getUser({ id: idSignal2 });

        // Should share cache - only one fetch call
        expect(mockFetch.calls.length).toBe(1);
        expect(result1.id).toBe(123);
        expect(result2.id).toBe(123);
      });
    });

    it('should create separate cache entries for different Signal values', async () => {
      const idSignal1 = signal('123');
      const idSignal2 = signal('456');
      mockFetch.get('/users/[id]', { id: 123, name: 'User 123' });
      mockFetch.get('/users/[id]', { id: 456, name: 'User 456' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const result1 = await getUser({ id: idSignal1 });
        const result2 = await getUser({ id: idSignal2 });

        // Should have separate cache entries - two fetch calls
        expect(mockFetch.calls.length).toBe(2);
        expect(result1.id).toBe(123);
        expect(result2.id).toBe(456);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle Signal with undefined value', async () => {
      const idSignal = signal<number | undefined>(undefined);
      mockFetch.get('/users', { id: null, name: 'No User' });

      const getUser = query(() => ({
        path: '/users',
        searchParams: {
          id: t.optional(t.number),
        },
        response: {
          id: t.nullable(t.number),
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        // This should work - undefined will be converted to string 'undefined' in URL
        const result = await getUser({ id: idSignal });
        expect(result.name).toBe('No User');
      });
    });

    it('should handle Signal with null value', async () => {
      const idSignal = signal<number | null>(null);
      mockFetch.get('/users', { id: null, name: 'No User' });

      const getUser = query(() => ({
        path: '/users',
        searchParams: {
          id: t.nullable(t.number),
        },
        response: {
          id: t.nullable(t.number),
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const result = await getUser({ id: idSignal });
        expect(result.name).toBe('No User');
      });
    });
  });
});
