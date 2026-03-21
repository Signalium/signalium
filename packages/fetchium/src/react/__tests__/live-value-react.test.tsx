import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider } from 'signalium/react';
import React from 'react';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { t } from '../../typeDefs.js';
import { Entity } from '../../proxy.js';
import { RESTQuery } from '../../query.js';
import { useQuery } from '../use-query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';

describe('LiveValue React', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('useQuery() + entity-level liveValue', () => {
    it('onCreate via applyEntityData increments count', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('List');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
        itemCount = t.liveValue(t.number, Item, {
          constraints: { listId: (this as any).id },
          onCreate: (v: number) => v + 1,
          onUpdate: (v: number) => v,
          onDelete: (v: number) => v - 1,
        });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: { __typename: 'List', id: '1', itemCount: 0, items: [] },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.itemCount}</span>
            <span data-testid="length">{list.items.length}</span>
            <button
              data-testid="add"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'create',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1', name: 'A' },
                });
              }}
            >
              Add
            </button>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ListComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('0');
      await expect.element(getByTestId('length')).toHaveTextContent('0');
      await getByTestId('add').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
      await expect.element(getByTestId('length')).toHaveTextContent('1');
    });

    it('onDelete via deleteEntity decrements count', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('List');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
        itemCount = t.liveValue(t.number, Item, {
          constraints: { listId: (this as any).id },
          onCreate: (v: number) => v + 1,
          onUpdate: (v: number) => v,
          onDelete: (v: number) => v - 1,
        });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: { __typename: 'List', id: '1', itemCount: 0, items: [] },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.itemCount}</span>
            <button
              data-testid="add"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'create',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1', name: 'A' },
                });
              }}
            >
              Add
            </button>
            <button
              data-testid="remove"
              onClick={() =>
                client.applyMutationEvent({
                  type: 'delete',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1' },
                })
              }
            >
              Remove
            </button>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ListComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('0');
      await getByTestId('add').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
      await getByTestId('remove').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('0');
    });

    it('onUpdate via applyEntityData keeps count unchanged', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('List');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
        itemCount = t.liveValue(t.number, Item, {
          constraints: { listId: (this as any).id },
          onCreate: (v: number) => v + 1,
          onUpdate: (v: number) => v,
          onDelete: (v: number) => v - 1,
        });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: { __typename: 'List', id: '1', itemCount: 0, items: [] },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.itemCount}</span>
            <button
              data-testid="add"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'create',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1', name: 'A' },
                });
              }}
            >
              Add
            </button>
            <button
              data-testid="update"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'update',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1', name: 'A-updated' },
                });
              }}
            >
              Update
            </button>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ListComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('0');
      await getByTestId('add').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
      await getByTestId('update').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
    });
  });
});
