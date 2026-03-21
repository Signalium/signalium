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

describe('LiveArray React', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('useQuery() + entity-level live array', () => {
    it('should render list items from entity-level liveArray', async () => {
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
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: {
          __typename: 'List',
          id: '1',
          items: [
            { __typename: 'Item', id: '1', listId: '1', name: 'A' },
            { __typename: 'Item', id: '2', listId: '1', name: 'B' },
          ],
        },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.items.length}</span>
            <ul>
              {list.items.map(item => (
                <li key={item.id} data-testid={`item-${item.id}`}>
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ListComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('2');
      await expect.element(getByTestId('item-1')).toHaveTextContent('A');
      await expect.element(getByTestId('item-2')).toHaveTextContent('B');
    });

    it('applyEntityData create adds item to entity-level liveArray', async () => {
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
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: { __typename: 'List', id: '1', items: [] },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.items.length}</span>
            <button
              data-testid="add"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'create',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '10', listId: '1', name: 'New' },
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
      await getByTestId('add').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
    });

    it('deleteEntity removes item from entity-level liveArray', async () => {
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
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: {
          __typename: 'List',
          id: '1',
          items: [
            { __typename: 'Item', id: '1', listId: '1', name: 'A' },
            { __typename: 'Item', id: '2', listId: '1', name: 'B' },
          ],
        },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.items.length}</span>
            <button
              data-testid="delete"
              onClick={() =>
                client.applyMutationEvent({
                  type: 'delete',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '1', listId: '1' },
                })
              }
            >
              Delete
            </button>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <ListComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('2');
      await getByTestId('delete').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
    });

    it('applyEntityData update keeps count stable in entity-level liveArray', async () => {
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
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/list/[id]', {
        list: {
          __typename: 'List',
          id: '1',
          items: [{ __typename: 'Item', id: '1', listId: '1', name: 'Original' }],
        },
      });

      function ListComponent() {
        const result = useQuery(GetList, { id: '1' });
        if (!result.isReady) return <div data-testid="loading">Loading...</div>;
        const list = result.value.list;
        return (
          <div>
            <span data-testid="count">{list.items.length}</span>
            <button
              data-testid="update"
              onClick={() => {
                client.applyMutationEvent({
                  type: 'update',
                  typename: 'Item',
                  data: { __typename: 'Item', id: '1', listId: '1', name: 'Updated' },
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

      await expect.element(getByTestId('count')).toHaveTextContent('1');
      await getByTestId('update').click();
      await sleep(300);
      await expect.element(getByTestId('count')).toHaveTextContent('1');
    });
  });
});
