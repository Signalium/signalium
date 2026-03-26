import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { RESTMutation, getMutation } from '../mutation.js';
import { createMockFetch, testWithClient, sleep, getEntityMapSize } from './utils.js';
import type { MutationEvent } from '../types.js';

async function applyEventOutsideReactiveContext(client: QueryClient, event: MutationEvent): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      client.applyMutationEvent(event);
      resolve();
    }, 0);
  });
  await sleep(10);
}

describe('LiveArray', () => {
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
  // Basic behavior
  // ============================================================

  it('should define entity with liveArray and return reactive array from query', async () => {
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;

      const list = relay.value!.list;
      const items = reactive(() => list.items);

      expect(items()).toBeDefined();
      expect(Array.isArray(items())).toBe(true);
      expect(items().length).toBe(2);
      expect(items()[0].name).toBe('A');
      expect(items()[1].name).toBe('B');
    });
  });

  it('should support liveArray without constraints (local-only)', async () => {
    class Item extends Entity {
      __typename = t.typename('Item');
      id = t.id;
      name = t.string;
    }

    class GetItems extends RESTQuery {
      path = '/items';
      result = { items: t.liveArray(Item) };
    }

    mockFetch.get('/items', {
      items: [
        { __typename: 'Item', id: '1', name: 'A' },
        { __typename: 'Item', id: '2', name: 'B' },
      ],
    });

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItems);
      await relay;

      const result = relay.value!;
      const items = reactive(() => result.items);
      expect(items()).toHaveLength(2);
    });
  });

  // ============================================================
  // Constraint isolation
  // ============================================================

  it("constraint isolation: server fetch does NOT leak into other query's live array", async () => {
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

    class GetItems extends RESTQuery {
      path = '/items';
      result = { items: t.array(t.entity(Item)) };
    }

    mockFetch.get('/list/[id]', {
      list: { __typename: 'List', id: '1', items: [] },
    });
    mockFetch.get('/items', {
      items: [
        { __typename: 'Item', id: '1', listId: '1', name: 'FromB' },
        { __typename: 'Item', id: '2', listId: '1', name: 'FromB2' },
      ],
    });

    await testWithClient(client, async () => {
      const listRelay = fetchQuery(GetList, { id: '1' });
      await listRelay;
      const list = listRelay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(0);

      const itemsRelay = fetchQuery(GetItems);
      await itemsRelay;
      expect(itemsRelay.value!.items).toHaveLength(2);

      expect(items()).toHaveLength(0);
    });
  });

  it("constraint isolation: mutation DOES add to other query's live array", async () => {
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

    await testWithClient(client, async () => {
      const listRelay = fetchQuery(GetList, { id: '1' });
      await listRelay;
      const list = listRelay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(0);
    });

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '3', listId: '1', name: 'C' },
    });
    await sleep(5);

    await testWithClient(client, async () => {
      const listRelay = fetchQuery(GetList, { id: '1' });
      await listRelay;
      const list = listRelay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(1);
      expect(items()[0].name).toBe('C');
    });
  });

  // ============================================================
  // Mutation effects
  // ============================================================

  it('mutation effects (creates/updates/deletes) update entity-level live array', async () => {
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

    class CreateItem extends RESTMutation {
      params = { __typename: t.string, id: t.id, listId: t.string, name: t.string };
      path = '/items';
      method = 'POST' as const;
      result = { ok: t.boolean };
      effects = {
        creates: [[Item, this.params] as const],
      };
    }

    class DeleteItem extends RESTMutation {
      params = { id: t.id };
      path = `/items/${this.params.id}`;
      method = 'DELETE' as const;
      result = { ok: t.boolean };
      effects = {
        deletes: [[Item, this.params.id] as const],
      };
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
    mockFetch.post('/items', { ok: true });
    mockFetch.delete('/items/[id]', { ok: true });

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(2);

      const createMut = getMutation(CreateItem);
      await createMut.run({ __typename: 'Item', id: '3', listId: '1', name: 'C' });
      await sleep(10);
      expect(items()).toHaveLength(3);
      expect(items()[2].name).toBe('C');

      const deleteMut = getMutation(DeleteItem);
      await deleteMut.run({ id: '1' });
      await sleep(10);
      expect(items()).toHaveLength(2);
    });
  });

  // ============================================================
  // Event routing
  // ============================================================

  it('should update entity-level live array when applyMutationEvent sends create/delete events', async () => {
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(2);

      await applyEventOutsideReactiveContext(client, {
        type: 'create',
        typename: 'Item',
        data: { __typename: 'Item', id: '3', listId: '1', name: 'C' },
      });

      expect(items()).toHaveLength(3);
      expect(items()[2].name).toBe('C');

      await applyEventOutsideReactiveContext(client, {
        type: 'delete',
        typename: 'Item',
        data: '1',
      });

      expect(items()).toHaveLength(2);
    });
  });

  it('should persist entity added via applyEntityData across refetch', async () => {
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(2);
    });

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '3', listId: '1', name: 'C' },
    });
    await sleep(10);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(3);
    });
  });

  // ============================================================
  // Cold-boot persistence (entity-level parent)
  // ============================================================

  it('should restore live array entities from cache after client restart (entity parent)', async () => {
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

    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    const mockFetch1 = createMockFetch();
    const client1 = new QueryClient(store, { fetch: mockFetch1 as any });

    mockFetch1.get('/list/[id]', {
      list: {
        __typename: 'List',
        id: '1',
        items: [
          { __typename: 'Item', id: '1', listId: '1', name: 'A' },
          { __typename: 'Item', id: '2', listId: '1', name: 'B' },
        ],
      },
    });

    await testWithClient(client1, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(2);
    });

    client1.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '3', listId: '1', name: 'C' },
    });
    await sleep(10);

    client1.destroy();

    const mockFetch2 = createMockFetch();
    mockFetch2.get(
      '/list/[id]',
      {
        list: {
          __typename: 'List',
          id: '1',
          items: [
            { __typename: 'Item', id: '1', listId: '1', name: 'A' },
            { __typename: 'Item', id: '2', listId: '1', name: 'B' },
            { __typename: 'Item', id: '3', listId: '1', name: 'C' },
          ],
        },
      },
      { delay: 5000 },
    );
    const client2 = new QueryClient(store, { fetch: mockFetch2 as any });

    await testWithClient(client2, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      relay.value;
      await sleep();
      expect(relay.value).toBeDefined();
      const list = relay.value!.list;
      const items = reactive(() => list.items);
      expect(items()).toHaveLength(3);
      expect(items().map((i: any) => i.name)).toEqual(['A', 'B', 'C']);
    });

    client2.destroy();
  });

  // ============================================================
  // Cold-boot persistence (query-level parent)
  // ============================================================

  it('should restore live array entities from cache after client restart (query parent)', async () => {
    class Item extends Entity {
      __typename = t.typename('Item');
      id = t.id;
      category = t.string;
      name = t.string;
    }

    class GetItems extends RESTQuery {
      path = '/items';
      result = { items: t.liveArray(Item, { constraints: { category: 'books' } }) };
    }

    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    const mockFetch1 = createMockFetch();
    const client1 = new QueryClient(store, { fetch: mockFetch1 as any });

    mockFetch1.get('/items', {
      items: [
        { __typename: 'Item', id: '1', category: 'books', name: 'A' },
        { __typename: 'Item', id: '2', category: 'books', name: 'B' },
      ],
    });

    await testWithClient(client1, async () => {
      const relay = fetchQuery(GetItems);
      await relay;
      const result = relay.value!;
      const items = reactive(() => result.items);
      expect(items()).toHaveLength(2);
    });

    client1.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '3', category: 'books', name: 'C' },
    });
    await sleep(10);

    client1.destroy();

    const mockFetch2 = createMockFetch();
    mockFetch2.get(
      '/items',
      {
        items: [
          { __typename: 'Item', id: '1', category: 'books', name: 'A' },
          { __typename: 'Item', id: '2', category: 'books', name: 'B' },
          { __typename: 'Item', id: '3', category: 'books', name: 'C' },
        ],
      },
      { delay: 5000 },
    );
    const client2 = new QueryClient(store, { fetch: mockFetch2 as any });

    await testWithClient(client2, async () => {
      const relay = fetchQuery(GetItems);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      relay.value;
      await sleep();
      expect(relay.value).toBeDefined();
      const result = relay.value!;
      const items = reactive(() => result.items);
      expect(items()).toHaveLength(3);
      expect(items().map((i: any) => i.name)).toEqual(['A', 'B', 'C']);
    });

    client2.destroy();
  });

  // ============================================================
  // Constraint routing
  // ============================================================

  it('should add entity to correct list based on constraint', async () => {
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
    mockFetch.get('/list/[id]', {
      list: { __typename: 'List', id: '2', items: [] },
    });

    await testWithClient(client, async () => {
      const relay1 = fetchQuery(GetList, { id: '1' });
      await relay1;
      expect(relay1.value!.list.items).toHaveLength(0);
    });

    await testWithClient(client, async () => {
      const relay2 = fetchQuery(GetList, { id: '2' });
      await relay2;
      expect(relay2.value!.list.items).toHaveLength(0);
    });

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '1', listId: '1', name: 'A' },
    });
    await sleep(5);

    await testWithClient(client, async () => {
      const relay1 = fetchQuery(GetList, { id: '1' });
      await relay1;
      expect(relay1.value!.list.items).toHaveLength(1);

      const relay2 = fetchQuery(GetList, { id: '2' });
      await relay2;
      expect(relay2.value!.list.items).toHaveLength(0);
    });
  });

  // ============================================================
  // Shape validation
  // ============================================================

  it('partial payload does not add to live array when required fields are missing', async () => {
    class Item extends Entity {
      __typename = t.typename('Item');
      id = t.id;
      listId = t.string;
      name = t.string;
      email = t.string;
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      expect(relay.value!.list.items).toHaveLength(0);
    });

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '10', listId: '1', name: 'Incomplete' },
    });
    await sleep(5);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      expect(relay.value!.list.items).toHaveLength(0);
    });
  });

  it('optional fields still match when missing from payload', async () => {
    class Item extends Entity {
      __typename = t.typename('Item');
      id = t.id;
      listId = t.string;
      name = t.string;
      bio = t.optional(t.string);
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      expect(relay.value!.list.items).toHaveLength(0);
    });

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '10', listId: '1', name: 'No Bio' },
    });
    await sleep(5);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      expect(relay.value!.list.items).toHaveLength(1);
    });
  });

  it('no orphan entity creation when no live collection matches', async () => {
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

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      expect(relay.value!.list.items).toHaveLength(0);
    });

    const sizeBefore = getEntityMapSize(client);

    client.applyMutationEvent({
      type: 'create',
      typename: 'Item',
      data: { __typename: 'Item', id: '10', listId: '999', name: 'Orphan' },
    });
    await sleep(5);

    expect(getEntityMapSize(client)).toBe(sizeBefore);
  });

  // ============================================================
  // Delete routing
  // ============================================================

  it('delete removes from live array but entity persists when other query references it', async () => {
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

    class GetItem extends RESTQuery {
      params = { id: t.id };
      path = `/item/${this.params.id}`;
      result = { item: t.entity(Item) };
    }

    mockFetch.get('/list/[id]', {
      list: {
        __typename: 'List',
        id: '1',
        items: [{ __typename: 'Item', id: '1', listId: '1', name: 'A' }],
      },
    });
    mockFetch.get('/item/[id]', {
      item: { __typename: 'Item', id: '1', listId: '1', name: 'A' },
    });

    await testWithClient(client, async () => {
      const listRelay = fetchQuery(GetList, { id: '1' });
      const itemRelay = fetchQuery(GetItem, { id: '1' });
      await Promise.all([listRelay, itemRelay]);

      expect(listRelay.value!.list.items).toHaveLength(1);
      expect(itemRelay.value!.item.name).toBe('A');

      await applyEventOutsideReactiveContext(client, {
        type: 'delete',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', listId: '1' },
      });

      expect(listRelay.value!.list.items).toHaveLength(0);
      expect(itemRelay.value!.item.name).toBe('A');
      expect(getEntityMapSize(client)).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Update routing with full data
  // ============================================================

  it('update event routes full merged entity data to collections', async () => {
    class Item extends Entity {
      __typename = t.typename('Item');
      id = t.id;
      listId = t.string;
      name = t.string;
      email = t.string;
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
        items: [{ __typename: 'Item', id: '1', listId: '1', name: 'Alice', email: 'alice@example.com' }],
      },
    });

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetList, { id: '1' });
      await relay;
      const list = relay.value!.list;
      expect(list.items[0].name).toBe('Alice');
      expect(list.items[0].email).toBe('alice@example.com');

      await applyEventOutsideReactiveContext(client, {
        type: 'update',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', name: 'Bob' },
      });

      expect(list.items[0].name).toBe('Bob');
      expect(list.items[0].email).toBe('alice@example.com');
    });
  });

  // ============================================================
  // Nested object with live array
  // ============================================================

  describe('liveArray nested inside t.object()', () => {
    it('should initialize and receive events for liveArray nested in a plain object field', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        groupId = t.string;
        name = t.string;
      }

      class Group extends Entity {
        __typename = t.typename('Group');
        id = t.id;
        meta = t.object({
          items: t.liveArray(Item, { constraints: { groupId: (this as any).id } }),
        });
      }

      class GetGroup extends RESTQuery {
        params = { id: t.id };
        path = `/groups/${this.params.id}`;
        result = { group: t.entity(Group) };
      }

      mockFetch.get('/groups/[id]', {
        group: {
          __typename: 'Group',
          id: '1',
          meta: {
            items: [{ __typename: 'Item', id: '1', groupId: '1', name: 'A' }],
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetGroup, { id: '1' });
        await relay;

        const group = relay.value!.group;
        const items = reactive(() => group.meta.items);

        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('A');

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'Item',
          data: { __typename: 'Item', id: '2', groupId: '1', name: 'B' },
        });

        expect(items()).toHaveLength(2);
        expect(items()[1].name).toBe('B');
      });
    });

    it('should reset nested liveArray on refetch', async () => {
      class Item extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        groupId = t.string;
        name = t.string;
      }

      class Group extends Entity {
        __typename = t.typename('Group');
        id = t.id;
        meta = t.object({
          items: t.liveArray(Item, { constraints: { groupId: (this as any).id } }),
        });
      }

      class GetGroup extends RESTQuery {
        params = { id: t.id };
        path = `/groups/${this.params.id}`;
        result = { group: t.entity(Group) };
      }

      mockFetch.get('/groups/[id]', {
        group: {
          __typename: 'Group',
          id: '1',
          meta: {
            items: [{ __typename: 'Item', id: '1', groupId: '1', name: 'A' }],
          },
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetGroup, { id: '1' });
        await relay;

        const group = relay.value!.group;
        const items = reactive(() => group.meta.items);
        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('A');

        mockFetch.get('/groups/[id]', {
          group: {
            __typename: 'Group',
            id: '1',
            meta: {
              items: [
                { __typename: 'Item', id: '1', groupId: '1', name: 'A-updated' },
                { __typename: 'Item', id: '3', groupId: '1', name: 'C' },
              ],
            },
          },
        });

        (relay.value as any).__refetch();
        await relay;

        expect(items()).toHaveLength(2);
        expect(items()[0].name).toBe('A-updated');
        expect(items()[1].name).toBe('C');
      });
    });
  });
});
