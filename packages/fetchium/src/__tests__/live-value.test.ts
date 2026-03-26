import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';

describe('LiveValue', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  // ============================================================
  // Entity-level liveValue with constraints
  // ============================================================

  describe('entity-level liveValue with constraints', () => {
    it('constraint isolation: server fetch does NOT trigger liveValue reducers', async () => {
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

      class GetItems extends RESTQuery {
        path = '/items';
        result = { items: t.array(t.entity(Item)) };
      }

      mockFetch.get('/list/[id]', {
        list: { __typename: 'List', id: '1', itemCount: 0, items: [] },
      });
      mockFetch.get('/items', {
        items: [
          { __typename: 'Item', id: '1', listId: '1', name: 'A' },
          { __typename: 'Item', id: '2', listId: '1', name: 'B' },
        ],
      });

      await testWithClient(client, async () => {
        const listRelay = fetchQuery(GetList, { id: '1' });
        await listRelay;
        const list = listRelay.value!.list;
        const count = reactive(() => list.itemCount);
        expect(count()).toBe(0);

        const itemsRelay = fetchQuery(GetItems);
        await itemsRelay;
        expect(itemsRelay.value!.items).toHaveLength(2);
        expect(count()).toBe(0);
      });
    });

    it('constraint isolation: applyEntityData DOES trigger liveValue reducers', async () => {
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

      await testWithClient(client, async () => {
        const listRelay = fetchQuery(GetList, { id: '1' });
        await listRelay;
        const list = listRelay.value!.list;
        const count = reactive(() => list.itemCount);
        expect(count()).toBe(0);
      });

      client.applyMutationEvent({
        type: 'create',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', listId: '1', name: 'A' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const listRelay = fetchQuery(GetList, { id: '1' });
        await listRelay;
        const list = listRelay.value!.list;
        const count = reactive(() => list.itemCount);
        expect(count()).toBe(1);
      });
    });

    it('should update when matching entities are created and deleted via applyEntityData/deleteEntity', async () => {
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

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        expect(relay.value!.list.itemCount).toBe(0);
      });

      client.applyMutationEvent({
        type: 'create',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', listId: '1', name: 'A' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        expect(relay.value!.list.itemCount).toBe(1);
        expect(relay.value!.list.items.length).toBe(1);
      });

      client.applyMutationEvent({
        type: 'delete',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', listId: '1' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        expect(relay.value!.list.items.length).toBe(0);
      });
    });

    it('should start from server-provided value and not retroactively count items from initial server load', async () => {
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
        list: {
          __typename: 'List',
          id: '1',
          itemCount: 0,
          items: [{ __typename: 'Item', id: '1', listId: '1', name: 'A' }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.itemCount).toBe(0);
        expect(list.items.length).toBe(1);
      });
    });
  });

  // ============================================================
  // Entity-level liveValue lifecycle
  // ============================================================

  describe('entity-level liveValue lifecycle', () => {
    it('should increment on create and decrement on delete via applyEntityData', async () => {
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

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.items).toHaveLength(0);
        expect(list.itemCount).toBe(0);
      });

      client.applyMutationEvent({
        type: 'create',
        typename: 'Item',
        data: { __typename: 'Item', id: '3', listId: '1', name: 'C' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.items).toHaveLength(1);
        expect(list.itemCount).toBe(1);
      });

      client.applyMutationEvent({
        type: 'delete',
        typename: 'Item',
        data: { __typename: 'Item', id: '3', listId: '1' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.items).toHaveLength(0);
        expect(list.itemCount).toBe(0);
      });
    });
  });
});
