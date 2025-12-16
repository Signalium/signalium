import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, useReactive } from 'signalium/react';
import React, { memo } from 'react';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { infiniteQuery } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';
import { userEvent } from '@vitest/browser/context';

/**
 * React Tests for Infinite Query
 *
 * These tests focus on end-to-end user-facing behavior in React components
 * with infinite queries. They verify pagination UI patterns, loading states,
 * and re-render optimization.
 */

describe('React Infinite Query Integration', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Basic Rendering', () => {
    it('should show loading state on first page', async () => {
      mockFetch.get('/items', {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading first page...</div>;
        }

        if (query.isRejected) {
          return <div>Error: {String(query.error)}</div>;
        }

        return (
          <div>
            {query.value!.map((page, pageIndex) => (
              <div key={pageIndex}>
                {page.items.map(item => (
                  <div key={item.id}>{item.name}</div>
                ))}
              </div>
            ))}
          </div>
        );
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading first page...')).toBeInTheDocument();
      await expect.element(getByText('Item 1')).toBeInTheDocument();
      await expect.element(getByText('Item 2')).toBeInTheDocument();
    });

    it('should render first page data', async () => {
      mockFetch.get('/users', {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
        hasMore: false,
      });

      const listUsers = infiniteQuery(() => ({
        path: '/users',
        response: {
          users: t.array(t.object({ id: t.number, name: t.string })),
          hasMore: t.boolean,
        },
        pagination: {
          getNextPageParams: lastPage => {
            return lastPage.hasMore ? { page: 2 } : undefined;
          },
        },
      }));

      function Component(): React.ReactNode {
        const query = useReactive(listUsers);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div data-testid="users">
            {query
              .value!.flatMap(page => page.users)
              .map(user => (
                <div key={user.id} data-testid={`user-${user.id}`}>
                  {user.name}
                </div>
              ))}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('users')).toBeInTheDocument();
      await expect.element(getByTestId('user-1')).toBeInTheDocument();
      await expect.element(getByTestId('user-2')).toBeInTheDocument();
      await expect.element(getByTestId('user-3')).toBeInTheDocument();

      expect(getByTestId('user-1').element().textContent).toBe('Alice');
      expect(getByTestId('user-2').element().textContent).toBe('Bob');
      expect(getByTestId('user-3').element().textContent).toBe('Charlie');
    });

    it('should handle error state', async () => {
      const error = new Error('Failed to load items');
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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        if (query.isRejected) {
          return <div>Error occurred</div>;
        }

        return <div>Success</div>;
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Error occurred')).toBeInTheDocument();
    });
  });

  describe('Pagination UI Flow', () => {
    it('should load more pages when clicking Load More button', async () => {
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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="items">
              {query
                .value!.flatMap(page => page.items)
                .map(item => (
                  <div key={item.id} data-testid={`item-${item.id}`}>
                    {item.name}
                  </div>
                ))}
            </div>
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial load
      await expect.element(getByTestId('item-1')).toBeInTheDocument();
      await expect.element(getByTestId('item-2')).toBeInTheDocument();

      // Click load more
      await userEvent.click(getByTestId('load-more'));

      // Wait for next page
      await expect.element(getByTestId('item-3')).toBeInTheDocument();
      await expect.element(getByTestId('item-4')).toBeInTheDocument();

      // Click load more again
      await userEvent.click(getByTestId('load-more'));

      // Wait for third page
      await expect.element(getByTestId('item-5')).toBeInTheDocument();
      await expect.element(getByTestId('item-6')).toBeInTheDocument();

      // Button should be gone now (no more pages)
      expect(getByTestId('load-more').query()).toBeNull();
    });

    it('should show loading indicator while isFetchingMore is true', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: 'cursor-2',
      });
      mockFetch.get(
        '/items',
        {
          items: [{ id: 2, name: 'Item 2' }],
          nextCursor: null,
        },
        { delay: 200 },
      );

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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading first page...</div>;
        }

        return (
          <div>
            <div data-testid="items">
              {query
                .value!.flatMap(page => page.items)
                .map(item => (
                  <div key={item.id}>{item.name}</div>
                ))}
            </div>
            {query.isFetchingMore && <div data-testid="loading-more">Loading more...</div>}
            {query.hasNextPage && !query.isFetchingMore && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial load
      await expect.element(getByText('Item 1')).toBeInTheDocument();

      // Click load more
      await userEvent.click(getByTestId('load-more'));

      // Should show loading indicator
      await expect.element(getByTestId('loading-more')).toBeInTheDocument();

      // Wait for page to load
      await expect.element(getByText('Item 2')).toBeInTheDocument();

      // Loading indicator should be gone
      expect(getByTestId('loading-more').query()).toBeNull();
    });

    it('should disable Load More when no next page (all query params undefined)', async () => {
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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="items">
              {query
                .value!.flatMap(page => page.items)
                .map(item => (
                  <div key={item.id}>{item.name}</div>
                ))}
            </div>
            {query.hasNextPage ? (
              <button data-testid="load-more">Load More</button>
            ) : (
              <div data-testid="no-more">No more items</div>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('no-more')).toBeInTheDocument();
      expect(getByTestId('load-more').query()).toBeNull();
    });

    it('should render accumulated pages correctly', async () => {
      mockFetch.get('/posts', {
        posts: [
          { id: 1, title: 'Post 1' },
          { id: 2, title: 'Post 2' },
        ],
        page: 1,
        hasMore: true,
      });
      mockFetch.get('/posts', {
        posts: [
          { id: 3, title: 'Post 3' },
          { id: 4, title: 'Post 4' },
        ],
        page: 2,
        hasMore: true,
      });
      mockFetch.get('/posts', {
        posts: [{ id: 5, title: 'Post 5' }],
        page: 3,
        hasMore: false,
      });

      const listPosts = infiniteQuery(() => ({
        path: '/posts',
        searchParams: {
          page: t.union(t.number, t.undefined),
        },
        response: {
          posts: t.array(t.object({ id: t.number, title: t.string })),
          page: t.number,
          hasMore: t.boolean,
        },
        pagination: {
          getNextPageParams: lastPage => {
            return lastPage.hasMore ? { page: lastPage.page + 1 } : undefined;
          },
        },
      }));

      function Component(): React.ReactNode {
        const query = useReactive(listPosts);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        const allPosts = query.value!.flatMap(page => page.posts);

        return (
          <div>
            <div data-testid="post-count">Total: {allPosts.length}</div>
            <div>
              {query.value!.map((page, pageIndex) => (
                <div key={pageIndex} data-testid={`page-${pageIndex + 1}`}>
                  Page {pageIndex + 1}: {page.posts.length} posts
                </div>
              ))}
            </div>
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial page
      await expect.element(getByTestId('page-1')).toBeInTheDocument();
      expect(getByTestId('post-count').element().textContent).toBe('Total: 2');

      // Load second page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('page-2')).toBeInTheDocument();
      expect(getByTestId('post-count').element().textContent).toBe('Total: 4');

      // Load third page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('page-3')).toBeInTheDocument();
      expect(getByTestId('post-count').element().textContent).toBe('Total: 5');
    });
  });

  describe('Refetch in React', () => {
    it('should reset to first page when calling refetch', async () => {
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
        nextCursor: null,
      });
      mockFetch.get('/items', {
        items: [
          { id: 10, name: 'New Item 1' },
          { id: 11, name: 'New Item 2' },
        ],
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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        const allItems = query.value!.flatMap(page => page.items);

        return (
          <div>
            <div data-testid="items">
              {allItems.map(item => (
                <div key={item.id} data-testid={`item-${item.id}`}>
                  {item.name}
                </div>
              ))}
            </div>
            <div data-testid="page-count">Pages: {query.value!.length}</div>
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
            <button data-testid="refetch" onClick={() => query.refetch()}>
              Refetch
            </button>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial page
      await expect.element(getByTestId('item-1')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');

      // Load second page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('item-3')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 2');

      // Refetch
      await userEvent.click(getByTestId('refetch'));

      // Should reset to first page with new data
      await expect.element(getByTestId('item-10')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');
      expect(getByTestId('item-1').query()).toBeNull();
      expect(getByTestId('item-3').query()).toBeNull();
    });

    it('should reset to first page when data becomes stale', async () => {
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
        nextCursor: null,
      });
      mockFetch.get('/items', {
        items: [
          { id: 10, name: 'New Item 1' },
          { id: 11, name: 'New Item 2' },
        ],
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
        cache: {
          staleTime: 100, // 100ms stale time
        },
      }));

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        const allItems = query.value!.flatMap(page => page.items);

        return (
          <div>
            <div data-testid="items">
              {allItems.map(item => (
                <div key={item.id} data-testid={`item-${item.id}`}>
                  {item.name}
                </div>
              ))}
            </div>
            <div data-testid="page-count">Pages: {query.value!.length}</div>
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      function App() {
        const [show, setShow] = React.useState(true);

        return (
          <div>
            <button data-testid="toggle" onClick={() => setShow(!show)}>
              Toggle
            </button>
            {show ? <Component /> : <div data-testid="hidden">Hidden</div>}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      // Wait for initial page
      await expect.element(getByTestId('item-1')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');

      // Load second page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('item-3')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 2');

      // Hide component to deactivate query
      await userEvent.click(getByTestId('toggle'));
      await expect.element(getByTestId('hidden')).toBeInTheDocument();

      // Wait for data to become stale
      await sleep(150);

      // Show component again - should auto-refetch because data is stale
      await userEvent.click(getByTestId('toggle'));

      // Should reset to first page with new data
      await expect.element(getByTestId('item-10')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');
      expect(getByTestId('item-1').query()).toBeNull();
      expect(getByTestId('item-3').query()).toBeNull();
    });

    it('should allow fetching next page after stale data refetch', async () => {
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
        nextCursor: null,
      });
      mockFetch.get('/items', {
        items: [
          { id: 10, name: 'New Item 1' },
          { id: 11, name: 'New Item 2' },
        ],
        nextCursor: 'cursor-2',
      });
      mockFetch.get('/items', {
        items: [
          { id: 12, name: 'New Item 3' },
          { id: 13, name: 'New Item 4' },
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
        cache: {
          staleTime: 100, // 100ms stale time
        },
      }));

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        const allItems = query.value!.flatMap(page => page.items);

        return (
          <div>
            <div data-testid="items">
              {allItems.map(item => (
                <div key={item.id} data-testid={`item-${item.id}`}>
                  {item.name}
                </div>
              ))}
            </div>
            <div data-testid="page-count">Pages: {query.value!.length}</div>
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      function App() {
        const [show, setShow] = React.useState(true);

        return (
          <div>
            <button data-testid="toggle" onClick={() => setShow(!show)}>
              Toggle
            </button>
            {show ? <Component /> : <div data-testid="hidden">Hidden</div>}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      // Wait for initial page
      await expect.element(getByTestId('item-1')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');

      // Load second page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('item-3')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 2');

      // Hide component to deactivate query
      await userEvent.click(getByTestId('toggle'));
      await expect.element(getByTestId('hidden')).toBeInTheDocument();

      // Wait for data to become stale
      await sleep(150);

      // Show component again - should auto-refetch because data is stale
      await userEvent.click(getByTestId('toggle'));

      // Should reset to first page with new data
      await expect.element(getByTestId('item-10')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 1');
      expect(getByTestId('item-1').query()).toBeNull();
      expect(getByTestId('item-3').query()).toBeNull();

      // Should still be able to load next page
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('item-12')).toBeInTheDocument();
      expect(getByTestId('page-count').element().textContent).toBe('Pages: 2');
      expect(getByTestId('item-10').query()).not.toBeNull(); // First page still visible
    });

    it('should update component during refetch', async () => {
      mockFetch.get('/items', {
        items: [{ id: 1, name: 'Item 1' }],
        nextCursor: null,
      });
      mockFetch.get(
        '/items',
        {
          items: [{ id: 2, name: 'Item 2' }],
          nextCursor: null,
        },
        { delay: 50 },
      );

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

      function Component(): React.ReactNode {
        const query = useReactive(listItems);

        if (query.isPending) {
          return <div>Loading first page...</div>;
        }

        return (
          <div>
            {query.isRefetching && <div data-testid="refetching">Refetching...</div>}
            <div data-testid="items">
              {query
                .value!.flatMap(page => page.items)
                .map(item => (
                  <div key={item.id}>{item.name}</div>
                ))}
            </div>
            <button data-testid="refetch" onClick={() => query.refetch()}>
              Refetch
            </button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial load
      await expect.element(getByText('Item 1')).toBeInTheDocument();

      // Click refetch
      await userEvent.click(getByTestId('refetch'));

      // Should show refetching indicator
      await expect.element(getByTestId('refetching')).toBeInTheDocument();

      // Wait for refetch to complete
      await expect.element(getByText('Item 2')).toBeInTheDocument();

      // Refetching indicator should be gone
      expect(getByTestId('refetching').query()).toBeNull();
    });
  });

  describe('Data Updates', () => {
    it('should handle entity updates across pages', async () => {
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
          { __typename: 'User', id: 1, name: 'Alice Updated' }, // Same entity, updated
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

      function Component(): React.ReactNode {
        const query = useReactive(listUsers);

        if (query.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            {query.value!.map((page, pageIndex) => (
              <div key={pageIndex} data-testid={`page-${pageIndex + 1}`}>
                {page.users.map(user => (
                  <div key={user.id} data-testid={`user-${user.id}`}>
                    {user.name}
                  </div>
                ))}
              </div>
            ))}
            {query.hasNextPage && (
              <button data-testid="load-more" onClick={() => query.fetchNextPage()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial page
      await expect.element(getByTestId('user-1')).toBeInTheDocument();
      expect(getByTestId('user-1').element().textContent).toBe('Alice');

      // Load second page (which has updated Alice)
      await userEvent.click(getByTestId('load-more'));
      await expect.element(getByTestId('user-3')).toBeInTheDocument();

      // Alice should be updated in both pages
      const page1User1 = getByTestId('page-1').element().querySelector('[data-testid="user-1"]');
      const page2User1 = getByTestId('page-2').element().querySelector('[data-testid="user-1"]');

      expect(page1User1?.textContent).toBe('Alice Updated');
      expect(page2User1?.textContent).toBe('Alice Updated');
    });
  });
});
