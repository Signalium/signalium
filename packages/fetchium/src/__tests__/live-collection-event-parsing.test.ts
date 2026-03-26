import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t, registerFormat } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { Mask } from '../types.js';
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

describe('LiveCollection Event Parsing', () => {
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
  // Create events with full payload
  // ============================================================

  describe('Create events', () => {
    it('should parse and add entity to collection on create with full payload', async () => {
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
        const list = relay.value!.list;
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
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('C');
      });
    });

    it('should reject create when required fields are missing', async () => {
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

      // Missing 'email' field -> should not add
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

    it('should accept create when optional fields are missing', async () => {
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
  });

  // ============================================================
  // Create with multiple defs (summary vs detail layering)
  // ============================================================

  describe('Layering: summary vs detail defs', () => {
    it('should handle create with two bindings using different entity defs', async () => {
      class ItemSummary extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class ItemDetail extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        listId = t.string;
        name = t.string;
        email = t.string;
      }

      class SummaryList extends Entity {
        __typename = t.typename('SummaryList');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { listId: (this as any).id } });
      }

      class DetailList extends Entity {
        __typename = t.typename('DetailList');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { listId: (this as any).id } });
      }

      class GetSummaryList extends RESTQuery {
        params = { id: t.id };
        path = `/summary-list/${this.params.id}`;
        result = { list: t.entity(SummaryList) };
      }

      class GetDetailList extends RESTQuery {
        params = { id: t.id };
        path = `/detail-list/${this.params.id}`;
        result = { list: t.entity(DetailList) };
      }

      mockFetch.get('/summary-list/[id]', {
        list: { __typename: 'SummaryList', id: '1', items: [] },
      });
      mockFetch.get('/detail-list/[id]', {
        list: { __typename: 'DetailList', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryList, { id: '1' });
        const detailRelay = fetchQuery(GetDetailList, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        expect(summaryRelay.value!.list.items).toHaveLength(0);
        expect(detailRelay.value!.list.items).toHaveLength(0);
      });

      // Full payload satisfies both defs
      client.applyMutationEvent({
        type: 'create',
        typename: 'Item',
        data: { __typename: 'Item', id: '1', listId: '1', name: 'A', email: 'a@test.com' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryList, { id: '1' });
        const detailRelay = fetchQuery(GetDetailList, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        expect(summaryRelay.value!.list.items).toHaveLength(1);
        expect(summaryRelay.value!.list.items[0].name).toBe('A');

        expect(detailRelay.value!.list.items).toHaveLength(1);
        expect(detailRelay.value!.list.items[0].name).toBe('A');
        expect(detailRelay.value!.list.items[0].email).toBe('a@test.com');
      });
    });

    it('should only add to narrow binding when payload lacks wider def fields', async () => {
      class ItemSummary extends Entity {
        __typename = t.typename('NarrowItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class ItemDetail extends Entity {
        __typename = t.typename('NarrowItem');
        id = t.id;
        listId = t.string;
        name = t.string;
        email = t.string;
      }

      class SummaryList extends Entity {
        __typename = t.typename('SummaryList2');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { listId: (this as any).id } });
      }

      class DetailList extends Entity {
        __typename = t.typename('DetailList2');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { listId: (this as any).id } });
      }

      class GetSummaryList extends RESTQuery {
        params = { id: t.id };
        path = `/summary-list2/${this.params.id}`;
        result = { list: t.entity(SummaryList) };
      }

      class GetDetailList extends RESTQuery {
        params = { id: t.id };
        path = `/detail-list2/${this.params.id}`;
        result = { list: t.entity(DetailList) };
      }

      mockFetch.get('/summary-list2/[id]', {
        list: { __typename: 'SummaryList2', id: '1', items: [] },
      });
      mockFetch.get('/detail-list2/[id]', {
        list: { __typename: 'DetailList2', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryList, { id: '1' });
        const detailRelay = fetchQuery(GetDetailList, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        expect(summaryRelay.value!.list.items).toHaveLength(0);
        expect(detailRelay.value!.list.items).toHaveLength(0);
      });

      // Payload only has summary fields -> detail binding rejects
      client.applyMutationEvent({
        type: 'create',
        typename: 'NarrowItem',
        data: { __typename: 'NarrowItem', id: '1', listId: '1', name: 'A' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryList, { id: '1' });
        const detailRelay = fetchQuery(GetDetailList, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        expect(summaryRelay.value!.list.items).toHaveLength(1);
        expect(detailRelay.value!.list.items).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // Update events for existing entities
  // ============================================================

  describe('Update events for existing entities', () => {
    it('should update existing entity with partial payload', async () => {
      class Item extends Entity {
        __typename = t.typename('UpdItem');
        id = t.id;
        listId = t.string;
        name = t.string;
        email = t.string;
      }

      class List extends Entity {
        __typename = t.typename('UpdList');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/upd-list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/upd-list/[id]', {
        list: {
          __typename: 'UpdList',
          id: '1',
          items: [{ __typename: 'UpdItem', id: '1', listId: '1', name: 'Alice', email: 'alice@example.com' }],
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
          typename: 'UpdItem',
          data: { __typename: 'UpdItem', id: '1', name: 'Bob' },
        });

        expect(list.items[0].name).toBe('Bob');
        expect(list.items[0].email).toBe('alice@example.com');
      });
    });

    it('should route update through collection after merge with full data', async () => {
      class Item extends Entity {
        __typename = t.typename('RouteItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('RouteList');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/route-list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/route-list/[id]', {
        list: {
          __typename: 'RouteList',
          id: '1',
          items: [],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(0);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'RouteItem',
          data: { __typename: 'RouteItem', id: '1', listId: '1', name: 'A' },
        });

        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('A');

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'RouteItem',
          data: { __typename: 'RouteItem', id: '1', name: 'B' },
        });

        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('B');
        expect(items()[0].listId).toBe('1');
      });
    });
  });

  // ============================================================
  // Delete events
  // ============================================================

  describe('Delete events', () => {
    it('should delete from collection using existing entity data for routing', async () => {
      class Item extends Entity {
        __typename = t.typename('DelItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('DelList');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/del-list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/del-list/[id]', {
        list: {
          __typename: 'DelList',
          id: '1',
          items: [{ __typename: 'DelItem', id: '1', listId: '1', name: 'A' }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.items).toHaveLength(1);

        await applyEventOutsideReactiveContext(client, {
          type: 'delete',
          typename: 'DelItem',
          data: '1',
        });

        expect(list.items).toHaveLength(0);
      });
    });

    it('should handle delete with object data containing constraint fields', async () => {
      class Item extends Entity {
        __typename = t.typename('DelItem2');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('DelList2');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/del-list2/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/del-list2/[id]', {
        list: {
          __typename: 'DelList2',
          id: '1',
          items: [{ __typename: 'DelItem2', id: '1', listId: '1', name: 'A' }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        expect(list.items).toHaveLength(1);

        await applyEventOutsideReactiveContext(client, {
          type: 'delete',
          typename: 'DelItem2',
          data: { __typename: 'DelItem2', id: '1', listId: '1' },
        });

        expect(list.items).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // Format handling in events
  // ============================================================

  describe('Formatted fields in events', () => {
    it('should eagerly format date fields in create events', async () => {
      class Event extends Entity {
        __typename = t.typename('FmtEvent');
        id = t.id;
        channelId = t.string;
        title = t.string;
        startDate = t.format('date');
      }

      class Channel extends Entity {
        __typename = t.typename('FmtChannel');
        id = t.id;
        events = t.liveArray(Event, { constraints: { channelId: (this as any).id } });
      }

      class GetChannel extends RESTQuery {
        params = { id: t.id };
        path = `/fmt-channel/${this.params.id}`;
        result = { channel: t.entity(Channel) };
      }

      mockFetch.get('/fmt-channel/[id]', {
        channel: { __typename: 'FmtChannel', id: '1', events: [] },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetChannel, { id: '1' });
        await relay;
        expect(relay.value!.channel.events).toHaveLength(0);
      });

      client.applyMutationEvent({
        type: 'create',
        typename: 'FmtEvent',
        data: { __typename: 'FmtEvent', id: '1', channelId: '1', title: 'Meeting', startDate: '2024-06-15' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetChannel, { id: '1' });
        await relay;
        const events = relay.value!.channel.events;
        expect(events).toHaveLength(1);
        expect(events[0].title).toBe('Meeting');
        expect(events[0].startDate).toBeInstanceOf(Date);
      });
    });

    it('should eagerly format date fields in update events for existing entities', async () => {
      class Task extends Entity {
        __typename = t.typename('FmtTask');
        id = t.id;
        projectId = t.string;
        title = t.string;
        dueDate = t.format('date');
      }

      class Project extends Entity {
        __typename = t.typename('FmtProject');
        id = t.id;
        tasks = t.liveArray(Task, { constraints: { projectId: (this as any).id } });
      }

      class GetProject extends RESTQuery {
        params = { id: t.id };
        path = `/fmt-project/${this.params.id}`;
        result = { project: t.entity(Project) };
      }

      mockFetch.get('/fmt-project/[id]', {
        project: {
          __typename: 'FmtProject',
          id: '1',
          tasks: [{ __typename: 'FmtTask', id: '1', projectId: '1', title: 'Task A', dueDate: '2024-01-01' }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetProject, { id: '1' });
        await relay;
        const task = relay.value!.project.tasks[0];
        expect(task.dueDate).toBeInstanceOf(Date);

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'FmtTask',
          data: { __typename: 'FmtTask', id: '1', dueDate: '2024-12-25' },
        });

        expect(task.dueDate).toBeInstanceOf(Date);
        expect((task.dueDate as unknown as Date).getUTCFullYear()).toBe(2024);
        expect((task.dueDate as unknown as Date).getUTCMonth()).toBe(11);
        expect((task.dueDate as unknown as Date).getUTCDate()).toBe(25);
      });
    });
  });

  // ============================================================
  // No orphan entity on unmatched create
  // ============================================================

  describe('No orphan creation', () => {
    it('should not create orphan entity when no live collection matches', async () => {
      class Item extends Entity {
        __typename = t.typename('OrphanItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class List extends Entity {
        __typename = t.typename('OrphanList');
        id = t.id;
        items = t.liveArray(Item, { constraints: { listId: (this as any).id } });
      }

      class GetList extends RESTQuery {
        params = { id: t.id };
        path = `/orphan-list/${this.params.id}`;
        result = { list: t.entity(List) };
      }

      mockFetch.get('/orphan-list/[id]', {
        list: { __typename: 'OrphanList', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList, { id: '1' });
        await relay;
        expect(relay.value!.list.items).toHaveLength(0);
      });

      const sizeBefore = getEntityMapSize(client);

      client.applyMutationEvent({
        type: 'create',
        typename: 'OrphanItem',
        data: { __typename: 'OrphanItem', id: '10', listId: '999', name: 'Orphan' },
      });
      await sleep(5);

      expect(getEntityMapSize(client)).toBe(sizeBefore);
    });
  });
});
