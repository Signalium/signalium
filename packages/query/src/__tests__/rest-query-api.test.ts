import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NormalizedDocumentStore, MemoryPersistentStore } from '../documentStore.js';
import { QueryClient, entity, t, query, QueryClientContext } from '../client.js';
import { watcher, withContexts } from 'signalium';

/**
 * REST Query API Tests
 *
 * These tests focus on the PUBLIC query() API - what users will actually use.
 * All external fetch calls are mocked.
 */

function createTestWatcher<T>(fn: () => T): {
  values: T[];
  errors: Error[];
  unsub: () => void;
  waitForValue: () => Promise<T>;
} {
  const values: T[] = [];
  const errors: Error[] = [];
  let resolveNext: ((value: T) => void) | null = null;

  const w = watcher(() => {
    try {
      const value = fn();
      values.push(value);
      if (resolveNext) {
        resolveNext(value);
        resolveNext = null;
      }
    } catch (error) {
      errors.push(error as Error);
    }
  });

  const unsub = w.addListener(() => {});

  return {
    values,
    errors,
    unsub,
    waitForValue: () =>
      new Promise<T>(resolve => {
        if (values.length > 0) {
          resolve(values[values.length - 1]);
        } else {
          resolveNext = resolve;
        }
      }),
  };
}

describe('REST Query API', () => {
  let kv: MemoryPersistentStore;
  let store: NormalizedDocumentStore;
  let client: QueryClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new NormalizedDocumentStore(kv);
    mockFetch = vi.fn();
    client = new QueryClient(kv, store, { fetch: mockFetch as any });
  });

  describe('Basic Query Execution', () => {
    it('should execute a GET query with path parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 123, name: 'Test User' }),
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.id).toBe(123);
      expect(result.name).toBe('Test User');
      expect(mockFetch).toHaveBeenCalledWith('/users/123', { method: 'GET' });
    });

    it('should execute a GET query with search parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ users: [], page: 1, total: 0 }),
      });

      const listUsers = query(t => ({
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

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = listUsers({ page: 1, limit: 10 });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.page).toBe(1);
      expect(result.total).toBe(0);
      // Verify URL was constructed with search params
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('page=1');
      expect(callUrl).toContain('limit=10');
    });

    it('should execute a GET query with both path and search params', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ posts: [], userId: 5 }),
      });

      const getUserPosts = query(t => ({
        path: '/users/[userId]/posts',
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
          userId: t.number,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUserPosts({ userId: '5', status: 'published' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.userId).toBe(5);
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/users/5/posts');
      expect(callUrl).toContain('status=published');
    });

    it('should execute POST requests', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 456, name: 'New User', created: true }),
      });

      const createUser = query(t => ({
        path: '/users',
        method: 'POST',
        response: {
          id: t.number,
          name: t.string,
          created: t.boolean,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = createUser();
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.id).toBe(456);
      expect(result.created).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/users', { method: 'POST' });
    });

    it('should execute PUT requests', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ id: 123, name: 'Updated User', updated: true }),
      });

      const updateUser = query(t => ({
        path: '/users/[id]',
        method: 'PUT',
        response: {
          id: t.number,
          name: t.string,
          updated: t.boolean,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = updateUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.updated).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/users/123', { method: 'PUT' });
    });

    it('should execute DELETE requests', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ success: true, id: 123 }),
      });

      const deleteUser = query(t => ({
        path: '/users/[id]',
        method: 'DELETE',
        response: {
          success: t.boolean,
          id: t.number,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = deleteUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/users/123', {
        method: 'DELETE',
      });
    });

    it('should execute PATCH requests', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          id: 123,
          email: 'new@example.com',
          patched: true,
        }),
      });

      const patchUser = query(t => ({
        path: '/users/[id]',
        method: 'PATCH',
        response: {
          id: t.number,
          email: t.string,
          patched: t.boolean,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = patchUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.patched).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('/users/123', { method: 'PATCH' });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const error = new Error('Network connection failed');
      mockFetch.mockRejectedValueOnce(error);

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        await expect(relay).rejects.toThrow('Network connection failed');
        expect(relay.isRejected).toBe(true);
        expect(relay.error).toBe(error);

        w.unsub();
      });
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => {
          throw new Error('Unexpected token in JSON');
        },
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUser({ id: '123' });
        const w = createTestWatcher(() => relay.value);

        await expect(relay).rejects.toThrow('Unexpected token in JSON');

        w.unsub();
      });
    });

    it('should require QueryClient context', async () => {
      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      // Call without context
      expect(() => getUser({ id: '123' })).toThrow('QueryClient not found');
    });
  });

  describe('Query Deduplication', () => {
    it('should deduplicate identical queries', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ id: 123, name: 'Test User' }),
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        const relay1 = getUser({ id: '123' });
        const relay2 = getUser({ id: '123' });
        const relay3 = getUser({ id: '123' });

        // Should return the same relay instance
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        const w1 = createTestWatcher(() => relay1.value);
        await relay1;
        w1.unsub();

        // Should only fetch once
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });

    it('should create separate queries for different parameters', async () => {
      mockFetch.mockImplementation(async (url: string) => ({
        json: async () => ({
          id: parseInt(url.split('/').pop()!),
          name: 'User',
        }),
      }));

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        const relay1 = getUser({ id: '1' });
        const relay2 = getUser({ id: '2' });

        // Should be different relay instances
        expect(relay1).not.toBe(relay2);

        const w1 = createTestWatcher(() => relay1.value);
        const w2 = createTestWatcher(() => relay2.value);

        const [result1, result2] = await Promise.all([relay1, relay2]);

        expect(result1.id).toBe(1);
        expect(result2.id).toBe(2);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        w1.unsub();
        w2.unsub();
      });
    });
  });

  describe('Response Type Handling', () => {
    it('should handle primitive response types', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => 'Hello, World!',
      });

      const getMessage = query(t => ({
        path: '/message',
        response: t.string,
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getMessage();
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result).toBe('Hello, World!');
    });

    it('should handle array responses', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => [1, 2, 3, 4, 5],
      });

      const getNumbers = query(t => ({
        path: '/numbers',
        response: t.array(t.number),
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getNumbers();
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle nested object responses', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          user: {
            id: 1,
            profile: {
              name: 'Alice',
              email: 'alice@example.com',
            },
          },
        }),
      });

      const getUser = query(t => ({
        path: '/user',
        response: {
          user: t.object({
            id: t.number,
            profile: t.object({
              name: t.string,
              email: t.string,
            }),
          }),
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUser();
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.user.profile.name).toBe('Alice');
      expect(result.user.profile.email).toBe('alice@example.com');
    });
  });

  describe('Entity Handling', () => {
    it('should handle entity responses', async () => {
      const User = entity('User', () => ({
        id: t.number,
        name: t.string,
        email: t.string,
      }));

      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
          },
        }),
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          user: User,
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = getUser({ id: '1' });
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.user.name).toBe('Alice');
      expect(result.user.email).toBe('alice@example.com');

      // Verify entity was cached
      const entityMap = client.getEntityMap();
      expect(entityMap.size).toBe(1);
    });

    it('should handle array of entities', async () => {
      const User = entity('User', () => ({
        id: t.number,
        name: t.string,
      }));

      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          users: [
            { __typename: 'User', id: 1, name: 'Alice' },
            { __typename: 'User', id: 2, name: 'Bob' },
            { __typename: 'User', id: 3, name: 'Charlie' },
          ],
        }),
      });

      const listUsers = query(t => ({
        path: '/users',
        response: {
          users: t.array(User),
        },
      }));

      const result = await withContexts([[QueryClientContext, client]], async () => {
        const relay = listUsers();
        const w = createTestWatcher(() => relay.value);

        const data = await relay;
        w.unsub();

        return data;
      });

      expect(result.users).toHaveLength(3);
      expect(result.users[0].name).toBe('Alice');
      expect(result.users[1].name).toBe('Bob');
      expect(result.users[2].name).toBe('Charlie');

      // Verify all entities were cached
      const entityMap = client.getEntityMap();
      expect(entityMap.size).toBe(3);
    });

    it('should deduplicate entities across queries', async () => {
      const User = entity('User', () => ({
        id: t.number,
        name: t.string,
      }));

      mockFetch
        .mockResolvedValueOnce({
          json: async () => ({
            user: { __typename: 'User', id: 1, name: 'Alice' },
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            users: [{ __typename: 'User', id: 1, name: 'Alice' }],
          }),
        });

      await withContexts([[QueryClientContext, client]], async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: {
            user: User,
          },
        }));

        const listUsers = query(t => ({
          path: '/users',
          response: {
            users: t.array(User),
          },
        }));

        const relay1 = getUser({ id: '1' });
        const w1 = createTestWatcher(() => relay1.value);
        const result1 = await relay1;

        const relay2 = listUsers();
        const w2 = createTestWatcher(() => relay2.value);
        const result2 = await relay2;

        // Should be the same entity proxy
        expect(result1.user).toBe(result2.users[0]);

        // Should only have one entity in the map
        const entityMap = client.getEntityMap();
        expect(entityMap.size).toBe(1);

        w1.unsub();
        w2.unsub();
      });
    });
  });

  describe('Optional Parameters', () => {
    it('should handle optional search parameters', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ users: [] }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const listUsers = query(t => ({
          path: '/users',
          searchParams: {
            page: t.union(t.number, t.undefined),
            limit: t.union(t.number, t.undefined),
          },
          response: {
            users: t.array(t.object({ id: t.number, name: t.string })),
          },
        }));

        // Call without optional params
        const relay1 = listUsers({});
        const w1 = createTestWatcher(() => relay1.value);
        await relay1;
        w1.unsub();

        // Call with some params
        const relay2 = listUsers({ page: 1 });
        const w2 = createTestWatcher(() => relay2.value);
        await relay2;
        w2.unsub();

        // Call with all params
        const relay3 = listUsers({ page: 1, limit: 10 });
        const w3 = createTestWatcher(() => relay3.value);
        await relay3;
        w3.unsub();

        expect(mockFetch).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('Type Safety', () => {
    it('should infer correct types for path parameters', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ id: 1, name: 'Test' }),
      });

      const getItem = query(t => ({
        path: '/items/[itemId]/details/[detailId]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        // TypeScript should require both path params
        const relay = getItem({ itemId: '1', detailId: '2' });
        const w = createTestWatcher(() => relay.value);
        await relay;
        w.unsub();

        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/items/1/details/2'), { method: 'GET' });
      });
    });
  });
});
