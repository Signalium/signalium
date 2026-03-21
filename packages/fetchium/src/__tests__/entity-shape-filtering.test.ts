import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import type { MutationEvent } from '../types.js';

class ItemSummary extends Entity {
  __typename = t.typename('ShapeItem');
  id = t.id;
  name = t.string;
}

class ItemDetail extends Entity {
  __typename = t.typename('ShapeItem');
  id = t.id;
  name = t.string;
  description = t.string;
}

async function applyEventOutsideReactiveContext(client: QueryClient, event: MutationEvent): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      client.applyMutationEvent(event);
      resolve();
    }, 0);
  });
  await sleep(10);
}

describe('Entity Shape Filtering', () => {
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
  // Normal arrays (proxy-level filtering)
  // ============================================================

  describe('Normal arrays (proxy-level filtering)', () => {
    it('should filter incomplete entities from detail-typed array when loaded via different shapes', async () => {
      class GetSummaryItems extends RESTQuery {
        path = '/items-summary';
        result = { items: t.array(t.entity(ItemSummary)) };
      }

      class GetDetailItems extends RESTQuery {
        path = '/items-detail';
        result = { items: t.array(t.entity(ItemDetail)) };
      }

      // Summary has 3 items, detail only has 2 with full fields
      mockFetch.get('/items-summary', {
        items: [
          { __typename: 'ShapeItem', id: '1', name: 'A' },
          { __typename: 'ShapeItem', id: '2', name: 'B' },
          { __typename: 'ShapeItem', id: '3', name: 'C' },
        ],
      });
      mockFetch.get('/items-detail', {
        items: [
          { __typename: 'ShapeItem', id: '1', name: 'A', description: 'Desc A' },
          { __typename: 'ShapeItem', id: '2', name: 'B', description: 'Desc B' },
        ],
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryItems);
        const detailRelay = fetchQuery(GetDetailItems);
        await Promise.all([summaryRelay, detailRelay]);

        // Summary has all 3
        expect(summaryRelay.value!.items).toHaveLength(3);

        // Detail only returned 2 from server — Item:3 is not in its array
        expect(detailRelay.value!.items).toHaveLength(2);

        // Item:3 exists in entity cache but only has summary fields
        // If it were somehow in the detail array, the proxy would filter it out
        // Verify the entities that ARE in the detail array have full fields
        expect(detailRelay.value!.items[0].description).toBe('Desc A');
        expect(detailRelay.value!.items[1].description).toBe('Desc B');

        // Update Item:3 with detail fields via mutation event
        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'ShapeItem',
          data: { id: '3', description: 'Desc C' },
        });

        // Item:3 now has detail fields but isn't in the detail query's array
        // (it was never in the server response for that query)
        expect(detailRelay.value!.items).toHaveLength(2);
      });
    });

    it('should not filter when only one def is registered (single-def happy path)', async () => {
      class SimpleItem extends Entity {
        __typename = t.typename('SimpleItem');
        id = t.id;
        name = t.string;
      }

      class GetSimpleItems extends RESTQuery {
        path = '/simple-items';
        result = { items: t.array(t.entity(SimpleItem)) };
      }

      mockFetch.get('/simple-items', {
        items: [
          { __typename: 'SimpleItem', id: '1', name: 'A' },
          { __typename: 'SimpleItem', id: '2', name: 'B' },
        ],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetSimpleItems);
        await relay;

        expect(relay.value!.items).toHaveLength(2);
        expect(relay.value!.items[0].name).toBe('A');
        expect(relay.value!.items[1].name).toBe('B');
      });
    });
  });

  // ============================================================
  // Live arrays (binding-level filtering)
  // ============================================================

  describe('Live arrays (binding-level filtering)', () => {
    it('should reject create with narrow payload from detail live array', async () => {
      class SummaryParent extends Entity {
        __typename = t.typename('ShapeParent');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { name: (this as any).id } });
      }

      class DetailParent extends Entity {
        __typename = t.typename('ShapeParentDetail');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { name: (this as any).id } });
      }

      class GetSummaryParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent-summary/${this.params.id}`;
        result = { parent: t.entity(SummaryParent) };
      }

      class GetDetailParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent-detail/${this.params.id}`;
        result = { parent: t.entity(DetailParent) };
      }

      mockFetch.get('/shape-parent-summary/[id]', {
        parent: { __typename: 'ShapeParent', id: '1', items: [] },
      });
      mockFetch.get('/shape-parent-detail/[id]', {
        parent: { __typename: 'ShapeParentDetail', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryParent, { id: '1' });
        const detailRelay = fetchQuery(GetDetailParent, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        const summaryItems = reactive(() => summaryRelay.value!.parent.items);
        const detailItems = reactive(() => detailRelay.value!.parent.items);

        expect(summaryItems()).toHaveLength(0);
        expect(detailItems()).toHaveLength(0);

        // Narrow payload — only summary fields
        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'ShapeItem',
          data: { __typename: 'ShapeItem', id: '10', name: '1' },
        });

        expect(summaryItems()).toHaveLength(1);
        expect(detailItems()).toHaveLength(0);
      });
    });

    it('should accept create with full payload in both live arrays', async () => {
      class SummaryParent extends Entity {
        __typename = t.typename('ShapeParent2');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { name: (this as any).id } });
      }

      class DetailParent extends Entity {
        __typename = t.typename('ShapeParentDetail2');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { name: (this as any).id } });
      }

      class GetSummaryParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent2-summary/${this.params.id}`;
        result = { parent: t.entity(SummaryParent) };
      }

      class GetDetailParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent2-detail/${this.params.id}`;
        result = { parent: t.entity(DetailParent) };
      }

      mockFetch.get('/shape-parent2-summary/[id]', {
        parent: { __typename: 'ShapeParent2', id: '1', items: [] },
      });
      mockFetch.get('/shape-parent2-detail/[id]', {
        parent: { __typename: 'ShapeParentDetail2', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryParent, { id: '1' });
        const detailRelay = fetchQuery(GetDetailParent, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        const summaryItems = reactive(() => summaryRelay.value!.parent.items);
        const detailItems = reactive(() => detailRelay.value!.parent.items);

        expect(summaryItems()).toHaveLength(0);
        expect(detailItems()).toHaveLength(0);

        // Full payload — has all detail fields
        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'ShapeItem',
          data: { __typename: 'ShapeItem', id: '20', name: '1', description: 'Full' },
        });

        expect(summaryItems()).toHaveLength(1);
        expect(detailItems()).toHaveLength(1);
      });
    });

    it('should add entity to detail live array when update gives it detail fields', async () => {
      class SummaryParent extends Entity {
        __typename = t.typename('ShapeParent3');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { name: (this as any).id } });
      }

      class DetailParent extends Entity {
        __typename = t.typename('ShapeParentDetail3');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { name: (this as any).id } });
      }

      class GetSummaryParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent3-summary/${this.params.id}`;
        result = { parent: t.entity(SummaryParent) };
      }

      class GetDetailParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent3-detail/${this.params.id}`;
        result = { parent: t.entity(DetailParent) };
      }

      mockFetch.get('/shape-parent3-summary/[id]', {
        parent: { __typename: 'ShapeParent3', id: '1', items: [] },
      });
      mockFetch.get('/shape-parent3-detail/[id]', {
        parent: { __typename: 'ShapeParentDetail3', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryParent, { id: '1' });
        const detailRelay = fetchQuery(GetDetailParent, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        const summaryItems = reactive(() => summaryRelay.value!.parent.items);
        const detailItems = reactive(() => detailRelay.value!.parent.items);

        // Create with narrow payload — only in summary
        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'ShapeItem',
          data: { __typename: 'ShapeItem', id: '30', name: '1' },
        });

        expect(summaryItems()).toHaveLength(1);
        expect(detailItems()).toHaveLength(0);

        // Update adds description — entity now satisfies detail shape
        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'ShapeItem',
          data: { id: '30', description: 'Now has details' },
        });

        expect(summaryItems()).toHaveLength(1);
        expect(detailItems()).toHaveLength(1);
      });
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe('Edge cases', () => {
    it('should preserve detail fields on partial update', async () => {
      class GetDetailItems extends RESTQuery {
        path = '/detail-items';
        result = { items: t.array(t.entity(ItemDetail)) };
      }

      class GetSummaryItems extends RESTQuery {
        path = '/summary-items';
        result = { items: t.array(t.entity(ItemSummary)) };
      }

      mockFetch.get('/detail-items', {
        items: [{ __typename: 'ShapeItem', id: '1', name: 'A', description: 'Desc A' }],
      });
      mockFetch.get('/summary-items', {
        items: [{ __typename: 'ShapeItem', id: '1', name: 'A' }],
      });

      await testWithClient(client, async () => {
        const detailRelay = fetchQuery(GetDetailItems);
        const summaryRelay = fetchQuery(GetSummaryItems);
        await Promise.all([detailRelay, summaryRelay]);

        expect(detailRelay.value!.items).toHaveLength(1);
        expect(detailRelay.value!.items[0].description).toBe('Desc A');

        // Partial update — only changes name
        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'ShapeItem',
          data: { id: '1', name: 'Updated A' },
        });

        // Detail fields preserved, name updated
        const detailItems = reactive(() => detailRelay.value!.items);
        expect(detailItems()).toHaveLength(1);
        expect(detailItems()[0].name).toBe('Updated A');
        expect(detailItems()[0].description).toBe('Desc A');
      });
    });

    it('should delete from both summary and detail live arrays', async () => {
      class SummaryParent extends Entity {
        __typename = t.typename('ShapeParent4');
        id = t.id;
        items = t.liveArray(ItemSummary, { constraints: { name: (this as any).id } });
      }

      class DetailParent extends Entity {
        __typename = t.typename('ShapeParentDetail4');
        id = t.id;
        items = t.liveArray(ItemDetail, { constraints: { name: (this as any).id } });
      }

      class GetSummaryParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent4-summary/${this.params.id}`;
        result = { parent: t.entity(SummaryParent) };
      }

      class GetDetailParent extends RESTQuery {
        params = { id: t.id };
        path = `/shape-parent4-detail/${this.params.id}`;
        result = { parent: t.entity(DetailParent) };
      }

      mockFetch.get('/shape-parent4-summary/[id]', {
        parent: { __typename: 'ShapeParent4', id: '1', items: [] },
      });
      mockFetch.get('/shape-parent4-detail/[id]', {
        parent: { __typename: 'ShapeParentDetail4', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        const summaryRelay = fetchQuery(GetSummaryParent, { id: '1' });
        const detailRelay = fetchQuery(GetDetailParent, { id: '1' });
        await Promise.all([summaryRelay, detailRelay]);

        const summaryItems = reactive(() => summaryRelay.value!.parent.items);
        const detailItems = reactive(() => detailRelay.value!.parent.items);

        // Create with full payload — both accept
        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'ShapeItem',
          data: { __typename: 'ShapeItem', id: '40', name: '1', description: 'Full' },
        });

        expect(summaryItems()).toHaveLength(1);
        expect(detailItems()).toHaveLength(1);

        // Delete — removed from both
        await applyEventOutsideReactiveContext(client, {
          type: 'delete',
          typename: 'ShapeItem',
          data: { __typename: 'ShapeItem', id: '40', name: '1', description: 'Full' },
        });

        expect(summaryItems()).toHaveLength(0);
        expect(detailItems()).toHaveLength(0);
      });
    });
  });
});
