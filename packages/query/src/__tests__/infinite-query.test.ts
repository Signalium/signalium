import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { infiniteQuery } from '../query.js';
import { createMockFetch, testWithClient, getEntityMapSize } from './utils.js';
import { InfiniteQueryResult } from '../types.js';

/**
 * Infinite Query Tests
 *
 * Tests the infinite query functionality including pagination,
 * page accumulation, refetch behavior, and state management.
 */

describe('Infinite Query', () => {
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

  describe('Basic Infinite Query Execution', () => {
    it('should fetch first page and return array', async () => {
      mockFetch.get('/items', {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
        nextCursor: 'cursor-2',
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(
            t.object({
              id: t.number,
              name: t.string,
            }),
          ),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        const result = await query;

        // Result should be an array of pages
        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(1);
        expect(result[0].items).toHaveLength(2);
        expect(result[0].items[0].name).toBe('Item 1');
      });
    });

    it('should set hasNextPage to true when getNextPageParams returns params', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        expect(query.hasNextPage).toBe(true);
      });
    });

    it('should set hasNextPage to false when getNextPageParams returns all undefined values', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        expect(query.hasNextPage).toBe(false);
      });
    });

    it('should work with path parameters', async () => {
      mockFetch.get('/users/[userId]/posts', {
        posts: [{ id: 1, title: 'Post 1' }],
        hasMore: true,
      });

      const getUserPosts = infiniteQuery(() => ({
        path: '/users/[userId]/posts',
        searchParams: {
          page: t.union(t.number, t.undefined),
        },
        response: {
          posts: t.array(t.object({ id: t.number, title: t.string })),
          hasMore: t.boolean,
        },
        pagination: {
          getNextPageParams: (lastPage, params) => (lastPage.hasMore ? { page: (params?.page ?? 0) + 1 } : undefined),
        },
      }));

      await testWithClient(client, async () => {
        const query = getUserPosts({ userId: '123' });
        const result = await query;

        expect(result).toHaveLength(1);
        expect(result[0].posts[0].title).toBe('Post 1');
        expect(mockFetch.calls[0].url).toContain('/users/123/posts');
      });
    });

    it('should work with both path and search parameters', async () => {
      mockFetch.get('/users/[userId]/posts', {
        posts: [{ id: 1, title: 'Published Post' }],
        page: 1,
        hasMore: false,
      });

      const getUserPosts = infiniteQuery(() => ({
        path: '/users/[userId]/posts',
        searchParams: {
          status: t.string,
          page: t.union(t.number, t.undefined),
        },
        response: {
          posts: t.array(t.object({ id: t.number, title: t.string })),
          page: t.number,
          hasMore: t.boolean,
        },
        pagination: {
          getNextPageParams: (lastPage, params) =>
            lastPage.hasMore ? { status: params!.status, page: lastPage.page + 1 } : undefined,
        },
      }));

      await testWithClient(client, async () => {
        const query = getUserPosts({ userId: '123', status: 'published' });
        await query;

        const callUrl = mockFetch.calls[0].url;
        expect(callUrl).toContain('/users/123/posts');
        expect(callUrl).toContain('status=published');
      });
    });
  });

  describe('Pagination Flow', () => {
    it('should accumulate pages when calling fetchNextPage', async () => {
      mockFetch.get('/items', {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [
          { id: 3, name: 'Item 3' },
          { id: 4, name: 'Item 4' },
        ],
        nextCursor: 'cursor-3',
      });
      mockFetch.get('/items', {
        items: [
          { id: 5, name: 'Item 5' },
          { id: 6, name: 'Item 6' },
        ],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // First page
        expect(query.value).toHaveLength(1);
        expect(query.value![0].items).toHaveLength(2);
        expect(query.hasNextPage).toBe(true);

        // Fetch second page
        await query.fetchNextPage();
        expect(query.value).toHaveLength(2);
        expect(query.value![1].items[0].id).toBe(3);
        expect(query.hasNextPage).toBe(true);

        // Fetch third page
        await query.fetchNextPage();
        expect(query.value).toHaveLength(3);
        expect(query.value![2].items[0].id).toBe(5);
        expect(query.hasNextPage).toBe(false);
      });
    });

    it('should update hasNextPage after fetching', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        expect(query.hasNextPage).toBe(true);

        await query.fetchNextPage();
        expect(query.hasNextPage).toBe(false);
      });
    });

    it('should set isFetchingMore during page fetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      let query: InfiniteQueryResult<unknown>;

      await testWithClient(client, async () => {
        query = listItems();
        await query;

        expect(query.isFetchingMore).toBe(false);
      });

      const fetchPromise = query!.fetchNextPage();

      await testWithClient(client, async () => {
        expect(query.isFetchingMore).toBe(true);

        await fetchPromise;
        expect(query.isFetchingMore).toBe(false);
      });
    });

    it('should pass correct params to subsequent page fetches', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        page: 1,
        hasMore: true,
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        page: 2,
        hasMore: false,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          page: t.union(t.number, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          page: t.number,
          hasMore: t.boolean,
        },
        pagination: {
          getNextPageParams: lastPage => {
            return lastPage.hasMore ? { page: lastPage.page + 1 } : undefined;
          },
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        await query.fetchNextPage();

        // Check that the second call has page=2
        const secondCallUrl = mockFetch.calls[1].url;
        expect(secondCallUrl).toContain('page=2');
      });
    });
  });

  describe('Refetch Behavior', () => {
    it('should reset pagination when calling refetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });
      mockFetch.get('/items', {
        items: [{ id: 10, name: 'Item 10' }],
        nextCursor: 'cursor-11',
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // Fetch second page
        await query.fetchNextPage();
        expect(query.value).toHaveLength(2);

        // Refetch should reset to first page
        await query.refetch();
        expect(query.value).toHaveLength(1);
        expect(query.value![0].items[0].id).toBe(10);
      });
    });

    it('should set isRefetching during refetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: null,
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      let query: InfiniteQueryResult<unknown>;

      await testWithClient(client, async () => {
        query = listItems();
        await query;

        expect(query.isRefetching).toBe(false);
      });

      const refetchPromise = query!.refetch();

      await testWithClient(client, async () => {
        expect(query.isRefetching).toBe(true);

        await refetchPromise;
        expect(query.isRefetching).toBe(false);
      });
    });

    it('should recalculate hasNextPage after refetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        expect(query.hasNextPage).toBe(true);

        // Refetch returns data without next cursor
        await query.refetch();
        expect(query.hasNextPage).toBe(false);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network error on first page', async () => {
      const error = new Error('Network failed');
      mockFetch.get('/items', null, { error });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();

        await expect(query).rejects.toThrow('Network failed');
        expect(query.isRejected).toBe(true);
        expect(query.error).toBe(error);
      });
    });

    it('should handle network error on subsequent page', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      const error = new Error('Network failed on page 2');
      mockFetch.get('/items', null, { error });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // First page succeeds
        expect(query.value).toHaveLength(1);

        // Second page fails
        await expect(query.fetchNextPage()).rejects.toThrow('Network failed on page 2');

        expect(query.isRejected).toBe(true);
        expect(query.error).toBe(error);
        expect(query.value).toHaveLength(1);
      });
    });

    it('should allow retrying fetchNextPage after a failed fetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      const error = new Error('Network failed on page 2');
      mockFetch.get('/items', null, { error });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // First page succeeds
        expect(query.value).toHaveLength(1);
        expect(query.hasNextPage).toBe(true);

        // Second page fails
        await expect(query.fetchNextPage()).rejects.toThrow('Network failed on page 2');

        expect(query.isRejected).toBe(true);
        expect(query.error).toBe(error);
        // Query should still have next page available for retry
        expect(query.hasNextPage).toBe(true);
        expect(query.value).toHaveLength(1);

        // Retry should succeed
        await query.fetchNextPage();

        expect(query.value).toHaveLength(2);
        expect(query.value![1].items[0].id).toBe(2);
        expect(query.isRejected).toBe(false);
        expect(query.error).toBeUndefined();
        expect(query.isResolved).toBe(true);
        expect(query.hasNextPage).toBe(false);
      });
    });

    it('should throw error when calling fetchNextPage with no next page', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        expect(query.hasNextPage).toBe(false);
        await expect(query.fetchNextPage()).rejects.toThrow('No next page params');
      });
    });
  });

  describe('State Management', () => {
    it('should distinguish between isFetchingMore, isRefetching, and isFetching', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();

        // During initial fetch
        expect(query.isPending).toBe(true);
        expect(query.isRefetching).toBe(false);
        expect(query.isFetchingMore).toBe(false);
        expect(query.isFetching).toBe(true);

        await query;

        // After initial fetch
        expect(query.isPending).toBe(false);
        expect(query.isRefetching).toBe(false);
        expect(query.isFetchingMore).toBe(false);
        expect(query.isFetching).toBe(false);

        // During fetchNextPage
        const fetchMorePromise = query.fetchNextPage();
        expect(query.isPending).toBe(false);
        expect(query.isRefetching).toBe(false);
        expect(query.isFetchingMore).toBe(true);
        expect(query.isFetching).toBe(true);

        await fetchMorePromise;

        // After fetchNextPage
        expect(query.isPending).toBe(false);
        expect(query.isRefetching).toBe(false);
        expect(query.isFetchingMore).toBe(false);
        expect(query.isFetching).toBe(false);
      });
    });

    it('should prevent refetch during fetchNextPage', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // Start fetching next page
        const fetchMorePromise = query.fetchNextPage();

        // Try to refetch while fetching more
        expect(() => query.refetch()).toThrow('Query is fetching more, cannot refetch');

        await fetchMorePromise;
      });
    });

    it('should prevent fetchNextPage during refetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: 'cursor-3',
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // Start refetch
        const refetchPromise = query.refetch();

        // Try to fetch next page while refetching
        await expect(query.fetchNextPage()).rejects.toThrow('Query is refetching, cannot fetch next page');

        await refetchPromise;
      });
    });

    it('should return same promise when calling fetchNextPage concurrently', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [{ id: 2, name: 'Item 2' }],
        nextCursor: null,
      });

      const listItems = infiniteQuery(() => ({
        path: '/items',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          items: t.array(t.object({ id: t.number, name: t.string })),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listItems();
        await query;

        // Call fetchNextPage multiple times concurrently
        const promise1 = query.fetchNextPage();
        const promise2 = query.fetchNextPage();
        const promise3 = query.fetchNextPage();

        // Should return the same promise
        expect(promise1).toBe(promise2);
        expect(promise2).toBe(promise3);

        await promise1;

        // Should only have made 2 fetch calls (initial + one more)
        expect(mockFetch.calls).toHaveLength(2);
      });
    });
  });

  describe('Entity Tracking', () => {
    it('should accumulate entities across pages', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 3, name: 'Charlie' },
          { __typename: 'User', id: 4, name: 'Diana' },
        ],
        nextCursor: null,
      });

      const listUsers = infiniteQuery(() => ({
        path: '/users',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          users: t.array(User),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listUsers();
        await query;

        // After first page, should have 2 entities
        expect(getEntityMapSize(client)).toBe(2);

        await query.fetchNextPage();

        // After second page, should have 4 entities
        expect(getEntityMapSize(client)).toBe(4);
      });
    });

    it('should persist entities after refetch', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 3, name: 'Charlie' },
          { __typename: 'User', id: 4, name: 'Diana' },
        ],
        nextCursor: null,
      });
      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice Updated' },
          { __typename: 'User', id: 5, name: 'Eve' },
        ],
        nextCursor: 'cursor-2',
      });

      const listUsers = infiniteQuery(() => ({
        path: '/users',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          users: t.array(User),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listUsers();
        await query;

        await query.fetchNextPage();

        // Should have 4 entities
        expect(getEntityMapSize(client)).toBe(4);

        await query.refetch();

        // After refetch, should have 5 entities (1, 2, 3, 4, 5)
        expect(getEntityMapSize(client)).toBe(5);

        // Entity 1 should be updated
        expect(query.value![0].users[0].name).toBe('Alice Updated');
      });
    });

    it('should deduplicate entities across pages', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 2, name: 'Bob' }, // Duplicate
          { __typename: 'User', id: 3, name: 'Charlie' },
        ],
        nextCursor: null,
      });

      const listUsers = infiniteQuery(() => ({
        path: '/users',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          users: t.array(User),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      await testWithClient(client, async () => {
        const query = listUsers();
        await query;

        const firstPageBob = query.value![0].users[1];

        await query.fetchNextPage();

        const secondPageBob = query.value![1].users[0];

        // Should be the same entity proxy
        expect(firstPageBob).toBe(secondPageBob);

        // Should only have 3 unique entities
        expect(getEntityMapSize(client)).toBe(3);
      });
    });
  });

  describe('Cache Hydration', () => {
    it('should hydrate infinite query with entities from cache after restart', async () => {
      // Shared persistent store (simulates persistent storage that survives app restart)
      const persistentStore = new MemoryPersistentStore();
      const store = new SyncQueryStore(persistentStore);

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const listUsers = infiniteQuery(() => ({
        path: '/users',
        searchParams: {
          cursor: t.union(t.string, t.undefined),
        },
        response: {
          users: t.array(User),
          nextCursor: t.union(t.string, t.null),
        },
        pagination: {
          getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
        },
      }));

      // First client: fetch data and populate cache
      const mockFetch1 = createMockFetch();
      mockFetch1.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch1.get('/users', {
        users: [
          { __typename: 'User', id: 3, name: 'Charlie' },
          { __typename: 'User', id: 4, name: 'Diana' },
        ],
        nextCursor: null,
      });

      const client1 = new QueryClient(store, { fetch: mockFetch1 as any });

      await testWithClient(client1, async () => {
        const query = listUsers();
        await query;

        // Fetch second page
        await query.fetchNextPage();

        expect(query.value).toHaveLength(2);
        expect(query.value![0].users[0].name).toBe('Alice');
        expect(query.value![1].users[0].name).toBe('Charlie');
      });

      // Destroy first client (simulates app restart)
      client1.destroy();

      // Second client: should load from cache and resolve entity proxies correctly
      const mockFetch2 = createMockFetch();
      // Mock returns different data ("Fresh" suffix) with delay, so we can verify
      // the query loads cached data immediately rather than waiting for network
      mockFetch2.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice Fresh' },
          { __typename: 'User', id: 2, name: 'Bob Fresh' },
        ],
        nextCursor: 'cursor-2',
      }, { delay: 100 });

      const client2 = new QueryClient(new SyncQueryStore(persistentStore), { fetch: mockFetch2 as any });

      await testWithClient(client2, async () => {
        const query = listUsers();

        // Access value to trigger cache loading
        void query.value;

        // Wait a tick for cache to load (but not enough for network request)
        await new Promise(resolve => setTimeout(resolve, 10));

        // Should have loaded cached data with both pages
        expect(query.value).toHaveLength(2);

        // Entity proxies should resolve correctly (not be __entityRef placeholders)
        const firstPageUsers = query.value![0].users;
        const secondPageUsers = query.value![1].users;

        // Verify first page entities resolve
        expect(firstPageUsers[0].name).toBe('Alice');
        expect(firstPageUsers[0].__typename).toBe('User');
        expect(firstPageUsers[0].id).toBe(1);
        expect(firstPageUsers[1].name).toBe('Bob');

        // Verify second page entities resolve
        expect(secondPageUsers[0].name).toBe('Charlie');
        expect(secondPageUsers[0].__typename).toBe('User');
        expect(secondPageUsers[0].id).toBe(3);
        expect(secondPageUsers[1].name).toBe('Diana');

        // Ensure no __entityRef placeholders are exposed
        expect((firstPageUsers[0] as any).__entityRef).toBeUndefined();
        expect((secondPageUsers[0] as any).__entityRef).toBeUndefined();
      });

      client2.destroy();
    });
  });
});
