import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, component, useReactive } from 'signalium/react';
import React from 'react';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { t } from '../../typeDefs.js';
import { Entity } from '../../proxy.js';
import { RESTQuery, fetchQuery } from '../../query.js';
import { useQuery } from '../use-query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';

describe('__loadNext React Integration', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  class Item extends Entity {
    __typename = t.typename('Item');
    id = t.id;
    name = t.string;
  }

  beforeEach(() => {
    client?.destroy();
    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('useQuery', () => {
    it('should reflect __hasNext and __isLoadingNext reactively', async () => {
      mockFetch.get('/items', {
        items: [{ __typename: 'Item', id: '1', name: 'A' }],
        nextCursor: 'c1',
      });

      class GetItems extends RESTQuery {
        path = '/items';
        result = {
          items: t.liveArray(Item),
          nextCursor: t.nullish(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.nextCursor },
        };
      }

      function ItemList(): React.ReactNode {
        const query = useQuery(GetItems);

        if (query.isPending) {
          return <div data-testid="loading">Loading</div>;
        }

        const result = query.value!;

        return (
          <div>
            <div data-testid="count">{result.items.length}</div>
            <div data-testid="has-next">{String(result.__hasNext)}</div>
            <div data-testid="is-loading-next">{String(result.__isLoadingNext)}</div>
            {result.__hasNext && (
              <button data-testid="load-more" onClick={() => result.__loadNext()}>
                Load More
              </button>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ItemList />
        </ContextProvider>,
      );

      // Wait for initial data
      await expect.element(getByTestId('count')).toBeInTheDocument();
      expect(getByTestId('count').element().textContent).toBe('1');
      expect(getByTestId('has-next').element().textContent).toBe('true');
      expect(getByTestId('is-loading-next').element().textContent).toBe('false');

      // Load more button should be visible
      await expect.element(getByTestId('load-more')).toBeInTheDocument();

      // Set up next page response (last page — null cursor signals no more pages)
      mockFetch.get(
        '/items',
        {
          items: [{ __typename: 'Item', id: '2', name: 'B' }],
          nextCursor: null,
        },
        { delay: 50 },
      );

      // Click load more
      await getByTestId('load-more').click();

      // Should show loading state
      await sleep(10);
      expect(getByTestId('is-loading-next').element().textContent).toBe('true');

      // Wait for load to complete
      await sleep(100);

      // Should have accumulated items
      expect(getByTestId('count').element().textContent).toBe('2');
      // No more pages
      expect(getByTestId('has-next').element().textContent).toBe('false');
      expect(getByTestId('is-loading-next').element().textContent).toBe('false');

      // Load more button should be gone (has-next is false, so conditional render hides it)
      expect(getByTestId('has-next').element().textContent).toBe('false');
    });
  });

  describe('component()', () => {
    it('should reflect __hasNext and __isLoadingNext reactively', async () => {
      mockFetch.get('/items', {
        items: [{ __typename: 'Item', id: '1', name: 'A' }],
        nextCursor: 'c1',
      });

      class GetItems extends RESTQuery {
        path = '/items';
        result = {
          items: t.liveArray(Item),
          nextCursor: t.nullish(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.nextCursor },
        };
      }

      const ItemList = component(() => {
        const query = useReactive(fetchQuery, GetItems);

        if (query.isPending) {
          return <div data-testid="loading">Loading</div>;
        }

        const result = query.value!;

        return (
          <div>
            <div data-testid="count">{result.items.length}</div>
            <div data-testid="has-next">{String(result.__hasNext)}</div>
            <div data-testid="is-loading-next">{String(result.__isLoadingNext)}</div>
            {result.__hasNext && (
              <button data-testid="load-more" onClick={() => result.__loadNext()}>
                Load More
              </button>
            )}
          </div>
        );
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ItemList />
        </ContextProvider>,
      );

      // Wait for initial data
      await expect.element(getByTestId('count')).toBeInTheDocument();
      expect(getByTestId('count').element().textContent).toBe('1');
      expect(getByTestId('has-next').element().textContent).toBe('true');
      expect(getByTestId('is-loading-next').element().textContent).toBe('false');

      // Load more button should be visible
      await expect.element(getByTestId('load-more')).toBeInTheDocument();

      // Set up next page response (last page — null cursor signals no more pages)
      mockFetch.get(
        '/items',
        {
          items: [{ __typename: 'Item', id: '2', name: 'B' }],
          nextCursor: null,
        },
        { delay: 50 },
      );

      // Click load more
      await getByTestId('load-more').click();

      // Should show loading state
      await sleep(10);
      expect(getByTestId('is-loading-next').element().textContent).toBe('true');

      // Wait for load to complete
      await sleep(100);

      // Should have accumulated items
      expect(getByTestId('count').element().textContent).toBe('2');
      // No more pages
      expect(getByTestId('has-next').element().textContent).toBe('false');
      expect(getByTestId('is-loading-next').element().textContent).toBe('false');

      // Load more button should be gone (has-next is false)
      expect(getByTestId('has-next').element().textContent).toBe('false');
    });
  });
});
