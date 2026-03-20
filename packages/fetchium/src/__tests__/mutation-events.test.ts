import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { hashValue } from 'signalium/utils';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t, getEntityDef } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { JsonQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, getEntityMapSize, sleep } from './utils.js';
import type { MutationEvent } from '../types.js';

/**
 * Applies a mutation event outside the reactive tracking context.
 * setTimeout escapes the current reactive computation so that
 * `applyMutationEvent` doesn't accidentally create signal dependencies.
 */
async function applyEventOutsideReactiveContext(client: QueryClient, event: MutationEvent): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      client.applyMutationEvent(event);
      resolve();
    }, 0);
  });
  await sleep(10);
}

describe('Mutation Events', () => {
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

  // ============================================================
  // Update Events
  // ============================================================

  describe('Update Events', () => {
    it('should update an existing entity', async () => {
      class MutUser extends Entity {
        __typename = t.typename('MutUser');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      class GetMutUser extends JsonQuery {
        params = { id: t.id };
        path = `/mut-user/${this.params.id}`;
        result = { user: t.entity(MutUser) };
      }

      mockFetch.get('/mut-user/[id]', {
        user: {
          __typename: 'MutUser',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutUser, { id: '1' });
        await relay;

        const user = relay.value!.user;
        expect(user.name).toBe('Alice');
        expect(user.email).toBe('alice@example.com');

        const userName = reactive(() => user.name);
        expect(userName()).toBe('Alice');

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'MutUser',
          data: { id: '1', name: 'Alice Updated' },
        });

        expect(userName()).toBe('Alice Updated');
        expect(user.email).toBe('alice@example.com');
      });
    });

    it('should be a no-op when entity does not exist', async () => {
      class MutUserNoExist extends Entity {
        __typename = t.typename('MutUserNoExist');
        id = t.id;
        name = t.string;
      }

      class GetMutUserNoExist extends JsonQuery {
        params = { id: t.id };
        path = `/mut-user-noexist/${this.params.id}`;
        result = { user: t.entity(MutUserNoExist) };
      }

      mockFetch.get('/mut-user-noexist/[id]', {
        user: { __typename: 'MutUserNoExist', id: '1', name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutUserNoExist, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'update',
          typename: 'MutUserNoExist',
          data: { id: '999', name: 'Ghost' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore);
      });
    });

    it('should update multiple shapes of the same typename', async () => {
      class MutItemBase extends Entity {
        __typename = t.typename('MutItem');
        id = t.id;
        name = t.string;
      }

      class MutItemDetail extends Entity {
        __typename = t.typename('MutItem');
        id = t.id;
        name = t.string;
        description = t.string;
      }

      class GetMutItemBase extends JsonQuery {
        params = { id: t.id };
        path = `/mut-item-base/${this.params.id}`;
        result = { item: t.entity(MutItemBase) };
      }

      class GetMutItemDetail extends JsonQuery {
        params = { id: t.id };
        path = `/mut-item-detail/${this.params.id}`;
        result = { item: t.entity(MutItemDetail) };
      }

      mockFetch.get('/mut-item-base/[id]', {
        item: { __typename: 'MutItem', id: '1', name: 'Widget' },
      });
      mockFetch.get('/mut-item-detail/[id]', {
        item: { __typename: 'MutItem', id: '1', name: 'Widget', description: 'A fine widget' },
      });

      await testWithClient(client, async () => {
        const relayBase = fetchQuery(GetMutItemBase, { id: '1' });
        const relayDetail = fetchQuery(GetMutItemDetail, { id: '1' });
        await Promise.all([relayBase, relayDetail]);

        const base = relayBase.value!.item;
        const detail = relayDetail.value!.item;

        const baseName = reactive(() => base.name);
        const detailName = reactive(() => detail.name);

        expect(baseName()).toBe('Widget');
        expect(detailName()).toBe('Widget');

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'MutItem',
          data: { id: '1', name: 'Gadget' },
        });

        expect(baseName()).toBe('Gadget');
        expect(detailName()).toBe('Gadget');
        expect(detail.description).toBe('A fine widget');
      });
    });
  });

  // ============================================================
  // Create Events
  // ============================================================

  describe('Create Events', () => {
    it('should create an entity when payload satisfies the shape', async () => {
      class MutCreateItem extends Entity {
        __typename = t.typename('MutCreateItem');
        id = t.id;
        title = t.string;
      }

      class GetMutCreateItem extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-item/${this.params.id}`;
        result = { item: t.entity(MutCreateItem) };
      }

      mockFetch.get('/mut-create-item/[id]', {
        item: { __typename: 'MutCreateItem', id: '1', title: 'Existing' },
      });

      const def = getEntityDef(MutCreateItem);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutCreateItem, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'create',
          typename: 'MutCreateItem',
          data: { id: '10', title: 'New Item' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore + 1);

        const key = hashValue([`MutCreateItem:10`, def.shapeKey]);
        const instance = client.getEntity(key);
        expect(instance).toBeDefined();
        expect(instance!.data.title).toBe('New Item');
      });
    });

    it('should skip creation when payload is missing required fields', async () => {
      class MutCreateStrict extends Entity {
        __typename = t.typename('MutCreateStrict');
        id = t.id;
        name = t.string;
        requiredField = t.number;
      }

      class GetMutCreateStrict extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-strict/${this.params.id}`;
        result = { item: t.entity(MutCreateStrict) };
      }

      mockFetch.get('/mut-create-strict/[id]', {
        item: { __typename: 'MutCreateStrict', id: '1', name: 'Complete', requiredField: 42 },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutCreateStrict, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'create',
          typename: 'MutCreateStrict',
          data: { id: '10', name: 'Incomplete' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore);
      });
    });

    it('should treat create as update when entity already exists', async () => {
      class MutCreateExisting extends Entity {
        __typename = t.typename('MutCreateExisting');
        id = t.id;
        name = t.string;
      }

      class GetMutCreateExisting extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-existing/${this.params.id}`;
        result = { item: t.entity(MutCreateExisting) };
      }

      mockFetch.get('/mut-create-existing/[id]', {
        item: { __typename: 'MutCreateExisting', id: '1', name: 'Original' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutCreateExisting, { id: '1' });
        await relay;

        const item = relay.value!.item;
        const itemName = reactive(() => item.name);
        expect(itemName()).toBe('Original');

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'MutCreateExisting',
          data: { id: '1', name: 'Replaced' },
        });

        expect(itemName()).toBe('Replaced');
      });
    });

    it('should only create for shapes the payload satisfies when multiple views exist', async () => {
      class MutCreatePartialBase extends Entity {
        __typename = t.typename('MutCreatePartial');
        id = t.id;
        name = t.string;
      }

      class MutCreatePartialDetail extends Entity {
        __typename = t.typename('MutCreatePartial');
        id = t.id;
        name = t.string;
        bio = t.string;
      }

      class GetMutCreatePartialBase extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-partial-base/${this.params.id}`;
        result = { item: t.entity(MutCreatePartialBase) };
      }

      class GetMutCreatePartialDetail extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-partial-detail/${this.params.id}`;
        result = { item: t.entity(MutCreatePartialDetail) };
      }

      mockFetch.get('/mut-create-partial-base/[id]', {
        item: { __typename: 'MutCreatePartial', id: '1', name: 'Existing' },
      });
      mockFetch.get('/mut-create-partial-detail/[id]', {
        item: { __typename: 'MutCreatePartial', id: '1', name: 'Existing', bio: 'Has bio' },
      });

      const baseDef = getEntityDef(MutCreatePartialBase);
      const detailDef = getEntityDef(MutCreatePartialDetail);

      await testWithClient(client, async () => {
        const relayBase = fetchQuery(GetMutCreatePartialBase, { id: '1' });
        const relayDetail = fetchQuery(GetMutCreatePartialDetail, { id: '1' });
        await Promise.all([relayBase, relayDetail]);

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'create',
          typename: 'MutCreatePartial',
          data: { id: '5', name: 'Partial' },
        });

        // Only the base shape should be created (name is present)
        // Detail shape requires bio, which is missing
        expect(getEntityMapSize(client)).toBe(sizeBefore + 1);

        const baseKey = hashValue([`MutCreatePartial:5`, baseDef.shapeKey]);
        const detailKey = hashValue([`MutCreatePartial:5`, detailDef.shapeKey]);

        expect(client.getEntity(baseKey)).toBeDefined();
        expect(client.getEntity(detailKey)).toBeUndefined();
      });
    });

    it('should create all matching shapes when payload is complete', async () => {
      class MutCreateFullBase extends Entity {
        __typename = t.typename('MutCreateFull');
        id = t.id;
        name = t.string;
      }

      class MutCreateFullDetail extends Entity {
        __typename = t.typename('MutCreateFull');
        id = t.id;
        name = t.string;
        bio = t.string;
      }

      class GetMutCreateFullBase extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-full-base/${this.params.id}`;
        result = { item: t.entity(MutCreateFullBase) };
      }

      class GetMutCreateFullDetail extends JsonQuery {
        params = { id: t.id };
        path = `/mut-create-full-detail/${this.params.id}`;
        result = { item: t.entity(MutCreateFullDetail) };
      }

      mockFetch.get('/mut-create-full-base/[id]', {
        item: { __typename: 'MutCreateFull', id: '1', name: 'Existing' },
      });
      mockFetch.get('/mut-create-full-detail/[id]', {
        item: { __typename: 'MutCreateFull', id: '1', name: 'Existing', bio: 'Has bio' },
      });

      const baseDef = getEntityDef(MutCreateFullBase);
      const detailDef = getEntityDef(MutCreateFullDetail);

      await testWithClient(client, async () => {
        const relayBase = fetchQuery(GetMutCreateFullBase, { id: '1' });
        const relayDetail = fetchQuery(GetMutCreateFullDetail, { id: '1' });
        await Promise.all([relayBase, relayDetail]);

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'create',
          typename: 'MutCreateFull',
          data: { id: '6', name: 'Complete', bio: 'Has everything' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore + 2);

        const baseKey = hashValue([`MutCreateFull:6`, baseDef.shapeKey]);
        const detailKey = hashValue([`MutCreateFull:6`, detailDef.shapeKey]);

        expect(client.getEntity(baseKey)).toBeDefined();
        expect(client.getEntity(detailKey)).toBeDefined();
        expect(client.getEntity(detailKey)!.data.bio).toBe('Has everything');
      });
    });
  });

  // ============================================================
  // Delete Events
  // ============================================================

  describe('Delete Events', () => {
    it('should delete an existing entity', async () => {
      class MutDeleteItem extends Entity {
        __typename = t.typename('MutDeleteItem');
        id = t.id;
        name = t.string;
      }

      class GetMutDeleteItem extends JsonQuery {
        params = { id: t.id };
        path = `/mut-delete-item/${this.params.id}`;
        result = { item: t.entity(MutDeleteItem) };
      }

      mockFetch.get('/mut-delete-item/[id]', {
        item: { __typename: 'MutDeleteItem', id: '1', name: 'Doomed' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutDeleteItem, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);
        expect(sizeBefore).toBeGreaterThan(0);

        client.applyMutationEvent({
          type: 'delete',
          typename: 'MutDeleteItem',
          data: { id: '1' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore - 1);
      });
    });

    it('should delete using a string id', async () => {
      class MutDeleteStrId extends Entity {
        __typename = t.typename('MutDeleteStrId');
        id = t.id;
        name = t.string;
      }

      class GetMutDeleteStrId extends JsonQuery {
        params = { id: t.id };
        path = `/mut-delete-strid/${this.params.id}`;
        result = { item: t.entity(MutDeleteStrId) };
      }

      mockFetch.get('/mut-delete-strid/[id]', {
        item: { __typename: 'MutDeleteStrId', id: '1', name: 'Doomed' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutDeleteStrId, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'delete',
          typename: 'MutDeleteStrId',
          data: '1',
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore - 1);
      });
    });

    it('should be a no-op when deleting non-existing entity', async () => {
      class MutDeleteNone extends Entity {
        __typename = t.typename('MutDeleteNone');
        id = t.id;
        name = t.string;
      }

      class GetMutDeleteNone extends JsonQuery {
        params = { id: t.id };
        path = `/mut-delete-none/${this.params.id}`;
        result = { item: t.entity(MutDeleteNone) };
      }

      mockFetch.get('/mut-delete-none/[id]', {
        item: { __typename: 'MutDeleteNone', id: '1', name: 'Exists' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutDeleteNone, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'delete',
          typename: 'MutDeleteNone',
          data: '999',
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore);
      });
    });
  });

  // ============================================================
  // No-Op Scenarios
  // ============================================================

  describe('No-Op Scenarios', () => {
    it('should be a no-op when typename is not registered', () => {
      const sizeBefore = getEntityMapSize(client);

      client.applyMutationEvent({
        type: 'create',
        typename: 'CompletelyUnknownType',
        data: { id: '1', name: 'Nobody' },
      });

      expect(getEntityMapSize(client)).toBe(sizeBefore);
    });

    it('should be a no-op when data has no id', async () => {
      class MutNoId extends Entity {
        __typename = t.typename('MutNoId');
        id = t.id;
        name = t.string;
      }

      class GetMutNoId extends JsonQuery {
        params = { id: t.id };
        path = `/mut-noid/${this.params.id}`;
        result = { item: t.entity(MutNoId) };
      }

      mockFetch.get('/mut-noid/[id]', {
        item: { __typename: 'MutNoId', id: '1', name: 'Existing' },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetMutNoId, { id: '1' });
        await relay;

        const sizeBefore = getEntityMapSize(client);

        client.applyMutationEvent({
          type: 'create',
          typename: 'MutNoId',
          data: { name: 'No ID provided' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore);
      });
    });

    it('should handle all event types as no-ops for unregistered typename', () => {
      const sizeBefore = getEntityMapSize(client);

      const events: MutationEvent[] = [
        { type: 'create', typename: 'NeverRegistered', data: { id: '1' } },
        { type: 'update', typename: 'NeverRegistered', data: { id: '1' } },
        { type: 'delete', typename: 'NeverRegistered', data: '1' },
      ];

      for (const event of events) {
        client.applyMutationEvent(event);
      }

      expect(getEntityMapSize(client)).toBe(sizeBefore);
    });
  });
});
