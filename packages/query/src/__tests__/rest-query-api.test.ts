import { describe, it, expect, beforeEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient, getEntityMapSize } from './utils.js';

/**
 * REST Query API Tests
 *
 * These tests focus on the PUBLIC query() API - what users will actually use.
 * All external fetch calls are mocked.
 */

describe('REST Query API', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Basic Query Execution', () => {
    it('should execute a GET query with path parameters', async () => {
      mockFetch.get('/users/[id]', { id: 123, name: 'Test User' });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getUser({ id: '123' });
        const result = await relay;

        expect(result.id).toBe(123);
        expect(result.name).toBe('Test User');
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('GET');
      });
    });

    it('should execute a GET query with search parameters', async () => {
      mockFetch.get('/users', { users: [], page: 1, total: 0 });

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

      await testWithClient(client, async () => {
        const relay = listUsers({ page: 1, limit: 10 });
        const result = await relay;

        expect(result.page).toBe(1);
        expect(result.total).toBe(0);
        // Verify URL was constructed with search params
        const callUrl = mockFetch.calls[0].url;
        expect(callUrl).toContain('page=1');
        expect(callUrl).toContain('limit=10');
      });
    });

    it('should execute a GET query with both path and search params', async () => {
      mockFetch.get('/users/[userId]/posts', { posts: [], userId: 5 });

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

      await testWithClient(client, async () => {
        const relay = getUserPosts({ userId: '5', status: 'published' });
        const result = await relay;

        expect(result.userId).toBe(5);
        const callUrl = mockFetch.calls[0].url;
        expect(callUrl).toContain('/users/5/posts');
        expect(callUrl).toContain('status=published');
      });
    });

    it('should execute POST requests', async () => {
      mockFetch.post('/users', { id: 456, name: 'New User', created: true });

      const createUser = query(t => ({
        path: '/users',
        method: 'POST',
        response: {
          id: t.number,
          name: t.string,
          created: t.boolean,
        },
      }));

      await testWithClient(client, async () => {
        const relay = createUser();
        const result = await relay;

        expect(result.id).toBe(456);
        expect(result.created).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users');
        expect(mockFetch.calls[0].options.method).toBe('POST');
      });
    });

    it('should execute PUT requests', async () => {
      mockFetch.put('/users/[id]', { id: 123, name: 'Updated User', updated: true });

      const updateUser = query(t => ({
        path: '/users/[id]',
        method: 'PUT',
        response: {
          id: t.number,
          name: t.string,
          updated: t.boolean,
        },
      }));

      await testWithClient(client, async () => {
        const relay = updateUser({ id: '123' });
        const result = await relay;

        expect(result.updated).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('PUT');
      });
    });

    it('should execute DELETE requests', async () => {
      mockFetch.delete('/users/[id]', { success: true, id: 123 });

      const deleteUser = query(t => ({
        path: '/users/[id]',
        method: 'DELETE',
        response: {
          success: t.boolean,
          id: t.number,
        },
      }));

      await testWithClient(client, async () => {
        const relay = deleteUser({ id: '123' });
        const result = await relay;

        expect(result.success).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('DELETE');
      });
    });

    it('should execute PATCH requests', async () => {
      mockFetch.patch('/users/[id]', {
        id: 123,
        email: 'new@example.com',
        patched: true,
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

      await testWithClient(client, async () => {
        const relay = patchUser({ id: '123' });
        const result = await relay;

        expect(result.patched).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('PATCH');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const error = new Error('Network connection failed');
      mockFetch.get('/users/[id]', null, { error });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getUser({ id: '123' });

        await expect(relay).rejects.toThrow('Network connection failed');
        expect(relay.isRejected).toBe(true);
        expect(relay.error).toBe(error);
      });
    });

    it('should handle malformed JSON responses', async () => {
      mockFetch.get('/users/[id]', null, {
        jsonError: new Error('Unexpected token in JSON'),
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getUser({ id: '123' });

        await expect(relay).rejects.toThrow('Unexpected token in JSON');

        expect(relay.isRejected).toBe(true);
        expect(relay.error).toBeInstanceOf(Error);
        expect((relay.error as Error).message).toBe('Unexpected token in JSON');
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
      mockFetch.get('/users/[id]', { id: 123, name: 'Test User' });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '123' });
        const relay2 = getUser({ id: '123' });
        const relay3 = getUser({ id: '123' });

        // Should return the same relay instance
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        await relay1;

        // Should only fetch once
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should create separate queries for different parameters', async () => {
      // Mocks are matched in LIFO order (last added is matched first)
      mockFetch.get('/users/1', { id: 1, name: 'User' });
      mockFetch.get('/users/2', { id: 2, name: 'User' });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        const relay1 = getUser({ id: '1' });
        const relay2 = getUser({ id: '2' });

        // Should be different relay instances
        expect(relay1).not.toBe(relay2);

        const [result1, result2] = await Promise.all([relay1, relay2]);

        expect(result1.id).toBe(1);
        expect(result2.id).toBe(2);
        expect(mockFetch.calls).toHaveLength(2);
      });
    });
  });

  describe('Response Type Handling', () => {
    it('should handle primitive response types', async () => {
      mockFetch.get('/message', 'Hello, World!');

      const getMessage = query(t => ({
        path: '/message',
        response: t.string,
      }));

      await testWithClient(client, async () => {
        const relay = getMessage();
        const result = await relay;

        expect(result).toBe('Hello, World!');
      });
    });

    it('should handle array responses', async () => {
      mockFetch.get('/numbers', [1, 2, 3, 4, 5]);

      const getNumbers = query(t => ({
        path: '/numbers',
        response: t.array(t.number),
      }));

      await testWithClient(client, async () => {
        const relay = getNumbers();
        const result = await relay;

        expect(result).toEqual([1, 2, 3, 4, 5]);
      });
    });

    it('should handle nested object responses', async () => {
      mockFetch.get('/user', {
        user: {
          id: 1,
          profile: {
            name: 'Alice',
            email: 'alice@example.com',
          },
        },
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

      await testWithClient(client, async () => {
        const relay = getUser();
        const result = await relay;

        expect(result.user.profile.name).toBe('Alice');
        expect(result.user.profile.email).toBe('alice@example.com');
      });
    });
  });

  describe('Entity Handling', () => {
    it('should handle entity responses', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      const getUser = query(t => ({
        path: '/users/[id]',
        response: {
          user: User,
        },
      }));

      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.name).toBe('Alice');
        expect(result.user.email).toBe('alice@example.com');

        // Verify entity was cached
        expect(getEntityMapSize(client)).toBe(1);
      });
    });

    it('should handle array of entities', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
          { __typename: 'User', id: 3, name: 'Charlie' },
        ],
      });

      const listUsers = query(t => ({
        path: '/users',
        response: {
          users: t.array(User),
        },
      }));

      await testWithClient(client, async () => {
        const relay = listUsers();
        const result = await relay;

        expect(result.users).toHaveLength(3);
        expect(result.users[0].name).toBe('Alice');
        expect(result.users[1].name).toBe('Bob');
        expect(result.users[2].name).toBe('Charlie');

        // Verify all entities were cached
        expect(getEntityMapSize(client)).toBe(3);
      });
    });

    it('should deduplicate entities across queries', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });
      mockFetch.get('/users', {
        users: [{ __typename: 'User', id: 1, name: 'Alice' }],
      });

      await testWithClient(client, async () => {
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
        const result1 = await relay1;

        const relay2 = listUsers();
        const result2 = await relay2;

        // Should be the same entity proxy
        expect(result1.user).toBe(result2.users[0]);
      });
    });
  });

  describe('Optional Parameters', () => {
    it('should handle optional search parameters', async () => {
      mockFetch.get('/users', { users: [] });
      mockFetch.get('/users', { users: [] });
      mockFetch.get('/users', { users: [] });

      await testWithClient(client, async () => {
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
        await relay1;

        // Call with some params
        const relay2 = listUsers({ page: 1 });
        await relay2;

        // Call with all params
        const relay3 = listUsers({ page: 1, limit: 10 });
        await relay3;

        expect(mockFetch.calls).toHaveLength(3);
      });
    });
  });

  describe('Type Safety', () => {
    it('should infer correct types for path parameters', async () => {
      mockFetch.get('/items/[itemId]/details/[detailId]', { id: 1, name: 'Test' });

      const getItem = query(t => ({
        path: '/items/[itemId]/details/[detailId]',
        response: {
          id: t.number,
          name: t.string,
        },
      }));

      await testWithClient(client, async () => {
        // TypeScript should require both path params
        const relay = getItem({ itemId: '1', detailId: '2' });
        await relay;

        expect(mockFetch.calls[0].url).toContain('/items/1/details/2');
        expect(mockFetch.calls[0].options.method).toBe('GET');
      });
    });
  });
});
