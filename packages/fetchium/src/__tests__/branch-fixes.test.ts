import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep, getEntityMapSize } from './utils.js';
import { withRetry } from '../retry.js';
import { computeConstraintHash, ConstraintMatcher, buildFieldPaths } from '../ConstraintMatcher.js';
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

describe('Branch Fixes', () => {
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
  // 1. applyEntities data-driven merge
  // ============================================================

  describe('applyEntities data-driven merge', () => {
    it('should replace record fields on update and keep same proxy', async () => {
      class Config extends Entity {
        __typename = t.typename('Config');
        id = t.id;
        name = t.string;
        settings = t.record(t.string);
      }

      mockFetch.get('/config/[id]', {
        config: {
          __typename: 'Config',
          id: '1',
          name: 'v1',
          settings: { theme: 'dark', lang: 'en' },
        },
      });

      await testWithClient(client, async () => {
        class GetConfig extends RESTQuery {
          params = { id: t.id };
          path = `/config/${this.params.id}`;
          result = { config: t.entity(Config) };
        }

        const relay = fetchQuery(GetConfig, { id: '1' });
        const result = await relay;

        expect(result.config.settings).toEqual({ theme: 'dark', lang: 'en' });

        mockFetch.get('/config/[id]', {
          config: {
            __typename: 'Config',
            id: '1',
            name: 'v2',
            settings: { theme: 'light', lang: 'en', fontSize: '14px' },
          },
        });

        const result2 = await relay.value!.__refetch();
        // Records are replaced on update. Verify new data visible through same proxy.
        expect(result2.config.name).toBe('v2');
        expect(result.config).toBe(result2.config);
      });
    });

    it('should merge union object values correctly on update', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        label = t.union(t.object({ text: t.string, color: t.string }), t.string);
      }

      mockFetch.get('/tags/[id]', {
        tag: {
          __typename: 'Tag',
          id: '1',
          label: { text: 'Important', color: 'red' },
        },
      });

      await testWithClient(client, async () => {
        class GetTag extends RESTQuery {
          params = { id: t.id };
          path = `/tags/${this.params.id}`;
          result = { tag: t.entity(Tag) };
        }

        const relay = fetchQuery(GetTag, { id: '1' });
        const result = await relay;

        expect((result.tag.label as any).text).toBe('Important');
        expect((result.tag.label as any).color).toBe('red');

        mockFetch.get('/tags/[id]', {
          tag: {
            __typename: 'Tag',
            id: '1',
            label: { text: 'Updated', color: 'blue' },
          },
        });

        const result2 = await relay.value!.__refetch();
        expect((result2.tag.label as any).text).toBe('Updated');
        expect((result2.tag.label as any).color).toBe('blue');
      });
    });

    it('should handle nullable nested object with null value', async () => {
      class Profile extends Entity {
        __typename = t.typename('Profile');
        id = t.id;
        name = t.string;
        address = t.nullable(t.object({ city: t.string, zip: t.string }));
      }

      mockFetch.get('/profiles/[id]', {
        profile: {
          __typename: 'Profile',
          id: '1',
          name: 'Alice',
          address: { city: 'NYC', zip: '10001' },
        },
      });

      await testWithClient(client, async () => {
        class GetProfile extends RESTQuery {
          params = { id: t.id };
          path = `/profiles/${this.params.id}`;
          result = { profile: t.entity(Profile) };
        }

        const relay = fetchQuery(GetProfile, { id: '1' });
        const result = await relay;

        expect((result.profile.address as any).city).toBe('NYC');

        mockFetch.get('/profiles/[id]', {
          profile: {
            __typename: 'Profile',
            id: '1',
            name: 'Alice',
            address: null,
          },
        });

        const result2 = await relay.value!.__refetch();
        expect(result2.profile.address).toBeNull();
      });
    });
  });

  // ============================================================
  // 2. resetFromRaw child ref release
  // ============================================================

  describe('resetFromRaw child ref release', () => {
    it('should replace old items with new ones on refetch (resetFromRaw)', async () => {
      class RItem extends Entity {
        __typename = t.typename('RItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class RList extends Entity {
        __typename = t.typename('RList');
        id = t.id;
        items = t.liveArray(RItem, { constraints: { listId: (this as any).id } });
      }

      class GetRList extends RESTQuery {
        params = { id: t.id };
        path = `/rlist/${this.params.id}`;
        result = { list: t.entity(RList) };
      }

      mockFetch.get('/rlist/[id]', {
        list: {
          __typename: 'RList',
          id: '1',
          items: [
            { __typename: 'RItem', id: 'a', listId: '1', name: 'A' },
            { __typename: 'RItem', id: 'b', listId: '1', name: 'B' },
          ],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetRList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(2);
        expect(items()[0].name).toBe('A');
        expect(items()[1].name).toBe('B');

        // Refetch with different items — old items should be replaced
        mockFetch.get('/rlist/[id]', {
          list: {
            __typename: 'RList',
            id: '1',
            items: [{ __typename: 'RItem', id: 'c', listId: '1', name: 'C' }],
          },
        });

        await relay.value!.__refetch();
        expect(items()).toHaveLength(1);
        expect(items()[0].name).toBe('C');

        // Old items (A, B) are gone; only C remains in the array
        const names = items().map((i: any) => i.name);
        expect(names).toEqual(['C']);
      });
    });
  });

  // ============================================================
  // 3. Wrapping proxy immutability
  // ============================================================

  describe('wrapping proxy immutability', () => {
    it('should throw when mutating a wrapped array via push', async () => {
      class WItem extends Entity {
        __typename = t.typename('WItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class WList extends Entity {
        __typename = t.typename('WList');
        id = t.id;
        items = t.liveArray(WItem, { constraints: { listId: (this as any).id } });
      }

      mockFetch.get('/wlist/[id]', {
        list: {
          __typename: 'WList',
          id: '1',
          items: [{ __typename: 'WItem', id: '1', listId: '1', name: 'A' }],
        },
      });

      await testWithClient(client, async () => {
        class GetWList extends RESTQuery {
          params = { id: t.id };
          path = `/wlist/${this.params.id}`;
          result = { list: t.entity(WList) };
        }

        const relay = fetchQuery(GetWList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items) as any;
        const arr = items();

        expect(() => arr.push('bad')).toThrow();
      });
    });

    it('should throw when setting index on a wrapped array', async () => {
      class WItem2 extends Entity {
        __typename = t.typename('WItem2');
        id = t.id;
        name = t.string;
      }

      class WOwner extends Entity {
        __typename = t.typename('WOwner');
        id = t.id;
        tags = t.array(t.string);
      }

      mockFetch.get('/wowner/[id]', {
        owner: {
          __typename: 'WOwner',
          id: '1',
          tags: ['a', 'b'],
        },
      });

      await testWithClient(client, async () => {
        class GetWOwner extends RESTQuery {
          params = { id: t.id };
          path = `/wowner/${this.params.id}`;
          result = { owner: t.entity(WOwner) };
        }

        const relay = fetchQuery(GetWOwner, { id: '1' });
        await relay;
        const tags = relay.value!.owner.tags as any;

        expect(() => {
          tags[0] = 'mutated';
        }).toThrow();
      });
    });

    it('should throw when deleting from a wrapped array', async () => {
      class WItem3 extends Entity {
        __typename = t.typename('WItem3');
        id = t.id;
        name = t.string;
      }

      class WOwner2 extends Entity {
        __typename = t.typename('WOwner2');
        id = t.id;
        tags = t.array(t.string);
      }

      mockFetch.get('/wowner2/[id]', {
        owner: {
          __typename: 'WOwner2',
          id: '1',
          tags: ['x', 'y'],
        },
      });

      await testWithClient(client, async () => {
        class GetWOwner2 extends RESTQuery {
          params = { id: t.id };
          path = `/wowner2/${this.params.id}`;
          result = { owner: t.entity(WOwner2) };
        }

        const relay = fetchQuery(GetWOwner2, { id: '1' });
        await relay;
        const tags = relay.value!.owner.tags as any;

        expect(() => {
          delete tags[0];
        }).toThrow();
      });
    });
  });

  // ============================================================
  // 4. Entity proxy: set trap, Symbol keys, __typename, getOwnPropertyDescriptor
  // ============================================================

  describe('entity proxy traps', () => {
    it('proxy.__typename returns correct typename', async () => {
      class EUser extends Entity {
        __typename = t.typename('EUser');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser/[id]', {
        user: { __typename: 'EUser', id: '1', name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetEUser extends RESTQuery {
          params = { id: t.id };
          path = `/euser/${this.params.id}`;
          result = { user: t.entity(EUser) };
        }

        const relay = fetchQuery(GetEUser, { id: '1' });
        const result = await relay;
        expect(result.user.__typename).toBe('EUser');
      });
    });

    it('"__typename" in proxy returns true', async () => {
      class EUser2 extends Entity {
        __typename = t.typename('EUser2');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser2/[id]', {
        user: { __typename: 'EUser2', id: '1', name: 'Bob' },
      });

      await testWithClient(client, async () => {
        class GetEUser2 extends RESTQuery {
          params = { id: t.id };
          path = `/euser2/${this.params.id}`;
          result = { user: t.entity(EUser2) };
        }

        const relay = fetchQuery(GetEUser2, { id: '1' });
        const result = await relay;
        expect('__typename' in result.user).toBe(true);
      });
    });

    it('Object.keys(proxy) includes __typename', async () => {
      class EUser3 extends Entity {
        __typename = t.typename('EUser3');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser3/[id]', {
        user: { __typename: 'EUser3', id: '1', name: 'Charlie' },
      });

      await testWithClient(client, async () => {
        class GetEUser3 extends RESTQuery {
          params = { id: t.id };
          path = `/euser3/${this.params.id}`;
          result = { user: t.entity(EUser3) };
        }

        const relay = fetchQuery(GetEUser3, { id: '1' });
        const result = await relay;
        const keys = Object.keys(result.user);
        expect(keys).toContain('__typename');
        expect(keys).toContain('id');
        expect(keys).toContain('name');
      });
    });

    it('Object.getOwnPropertyDescriptor returns correct value', async () => {
      class EUser4 extends Entity {
        __typename = t.typename('EUser4');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser4/[id]', {
        user: { __typename: 'EUser4', id: '1', name: 'Diana' },
      });

      await testWithClient(client, async () => {
        class GetEUser4 extends RESTQuery {
          params = { id: t.id };
          path = `/euser4/${this.params.id}`;
          result = { user: t.entity(EUser4) };
        }

        const relay = fetchQuery(GetEUser4, { id: '1' });
        const result = await relay;

        const nameDesc = Object.getOwnPropertyDescriptor(result.user, 'name');
        expect(nameDesc).toBeDefined();
        expect(nameDesc!.value).toBe('Diana');

        const typenameDesc = Object.getOwnPropertyDescriptor(result.user, '__typename');
        expect(typenameDesc).toBeDefined();
        expect(typenameDesc!.value).toBe('EUser4');
      });
    });

    it('setting a property throws in dev mode', async () => {
      class EUser5 extends Entity {
        __typename = t.typename('EUser5');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser5/[id]', {
        user: { __typename: 'EUser5', id: '1', name: 'Eve' },
      });

      await testWithClient(client, async () => {
        class GetEUser5 extends RESTQuery {
          params = { id: t.id };
          path = `/euser5/${this.params.id}`;
          result = { user: t.entity(EUser5) };
        }

        const relay = fetchQuery(GetEUser5, { id: '1' });
        const result = await relay;

        expect(() => {
          (result.user as any).name = 'Hacked';
        }).toThrow('Entity properties are read-only');
      });
    });

    it('accessing a Symbol property returns undefined without reactive deps', async () => {
      class EUser6 extends Entity {
        __typename = t.typename('EUser6');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/euser6/[id]', {
        user: { __typename: 'EUser6', id: '1', name: 'Frank' },
      });

      await testWithClient(client, async () => {
        class GetEUser6 extends RESTQuery {
          params = { id: t.id };
          path = `/euser6/${this.params.id}`;
          result = { user: t.entity(EUser6) };
        }

        const relay = fetchQuery(GetEUser6, { id: '1' });
        const result = await relay;

        const sym = Symbol('test');
        expect((result.user as any)[sym]).toBeUndefined();
      });
    });
  });

  // ============================================================
  // 5. release() underflow guard
  // ============================================================

  describe('release() underflow guard', () => {
    it('double-release throws in dev mode', async () => {
      class DRUser extends Entity {
        __typename = t.typename('DRUser');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/druser/[id]', {
        user: { __typename: 'DRUser', id: '1', name: 'Alice' },
      });

      await testWithClient(client, async () => {
        class GetDRUser extends RESTQuery {
          params = { id: t.id };
          path = `/druser/${this.params.id}`;
          result = { user: t.entity(DRUser) };
        }

        const relay = fetchQuery(GetDRUser, { id: '1' });
        await relay;

        const entityMap = client.entityMap;
        const { hashValue: hv } = await import('signalium/utils');
        const key = hv(['DRUser', '1']);
        const entity = entityMap.getEntity(key);
        expect(entity).toBeDefined();

        entity!.retain();
        entity!.retain();
        entity!.release();
        entity!.release();
        // refCount is now back to the original. Release once more to hit 0.
        // Then release again for underflow.
        entity!.release();
        expect(() => entity!.release()).toThrow(/released more times than retained/);
      });
    });

    it('evict() clears entityRefs to prevent cascading damage', async () => {
      class EChild extends Entity {
        __typename = t.typename('EChild');
        id = t.id;
        name = t.string;
      }

      class EParent extends Entity {
        __typename = t.typename('EParent');
        id = t.id;
        child = t.entity(EChild);
      }

      mockFetch.get('/eparent/[id]', {
        parent: {
          __typename: 'EParent',
          id: '1',
          child: { __typename: 'EChild', id: 'c1', name: 'Kid' },
        },
      });

      await testWithClient(client, async () => {
        class GetEParent extends RESTQuery {
          params = { id: t.id };
          path = `/eparent/${this.params.id}`;
          result = { parent: t.entity(EParent) };
        }

        const relay = fetchQuery(GetEParent, { id: '1' });
        await relay;

        const entityMap = client.entityMap;
        const { hashValue: hv } = await import('signalium/utils');
        const parentKey = hv(['EParent', '1']);
        const parentEntity = entityMap.getEntity(parentKey);
        expect(parentEntity).toBeDefined();

        // evict clears entityRefs
        parentEntity!.evict();
        expect(parentEntity!.entityRefs).toBeUndefined();
      });
    });
  });

  // ============================================================
  // 6. Entity ID validation
  // ============================================================

  describe('entity ID validation', () => {
    it('entity with null id throws', async () => {
      class NullIdEntity extends Entity {
        __typename = t.typename('NullIdEntity');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/nullid', {
        item: { __typename: 'NullIdEntity', id: null, name: 'Bad' },
      });

      await expect(async () => {
        await testWithClient(client, async () => {
          class GetNullId extends RESTQuery {
            path = '/nullid';
            result = { item: t.entity(NullIdEntity) };
          }

          const relay = fetchQuery(GetNullId);
          await relay;
        });
      }).rejects.toThrow(/Entity id must be a string or number/);
    });

    it('entity with boolean id throws', async () => {
      class BoolIdEntity extends Entity {
        __typename = t.typename('BoolIdEntity');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/boolid', {
        item: { __typename: 'BoolIdEntity', id: true, name: 'Bad' },
      });

      await expect(async () => {
        await testWithClient(client, async () => {
          class GetBoolId extends RESTQuery {
            path = '/boolid';
            result = { item: t.entity(BoolIdEntity) };
          }

          const relay = fetchQuery(GetBoolId);
          await relay;
        });
      }).rejects.toThrow(/Entity id must be a string or number/);
    });

    it('entity with string id works', async () => {
      class StringIdEntity extends Entity {
        __typename = t.typename('StringIdEntity');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/strid', {
        item: { __typename: 'StringIdEntity', id: 'abc', name: 'OK' },
      });

      await testWithClient(client, async () => {
        class GetStrId extends RESTQuery {
          path = '/strid';
          result = { item: t.entity(StringIdEntity) };
        }

        const relay = fetchQuery(GetStrId);
        const result = await relay;
        expect(result.item.id).toBe('abc');
      });
    });

    it('entity with number id works', async () => {
      class NumIdEntity extends Entity {
        __typename = t.typename('NumIdEntity');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/numid', {
        item: { __typename: 'NumIdEntity', id: 42, name: 'OK' },
      });

      await testWithClient(client, async () => {
        class GetNumId extends RESTQuery {
          path = '/numid';
          result = { item: t.entity(NumIdEntity) };
        }

        const relay = fetchQuery(GetNumId);
        const result = await relay;
        expect(result.item.id).toBe(42);
      });
    });
  });

  // ============================================================
  // 7. satisfiesDef semantics
  // ============================================================

  describe('satisfiesDef semantics', () => {
    it('entity with null field values still satisfies shape', async () => {
      class NullFieldEntity extends Entity {
        __typename = t.typename('NullFieldEntity');
        id = t.id;
        name = t.nullable(t.string);
      }

      mockFetch.get('/nullfield', {
        item: { __typename: 'NullFieldEntity', id: '1', name: null },
      });

      await testWithClient(client, async () => {
        class GetNullField extends RESTQuery {
          path = '/nullfield';
          result = { item: t.entity(NullFieldEntity) };
        }

        const relay = fetchQuery(GetNullField);
        const result = await relay;
        expect(result.item.name).toBeNull();
        expect(result.item.id).toBe('1');
      });
    });

    it('partial entity missing a required field does not satisfy shape for live array', async () => {
      class StrictItem extends Entity {
        __typename = t.typename('StrictItem');
        id = t.id;
        listId = t.string;
        name = t.string;
        email = t.string;
      }

      class StrictList extends Entity {
        __typename = t.typename('StrictList');
        id = t.id;
        items = t.liveArray(StrictItem, { constraints: { listId: (this as any).id } });
      }

      mockFetch.get('/strictlist/[id]', {
        list: { __typename: 'StrictList', id: '1', items: [] },
      });

      await testWithClient(client, async () => {
        class GetStrictList extends RESTQuery {
          params = { id: t.id };
          path = `/strictlist/${this.params.id}`;
          result = { list: t.entity(StrictList) };
        }

        const relay = fetchQuery(GetStrictList, { id: '1' });
        await relay;
        expect(relay.value!.list.items).toHaveLength(0);
      });

      // Missing 'email' field — should NOT satisfy shape
      client.applyMutationEvent({
        type: 'create',
        typename: 'StrictItem',
        data: { __typename: 'StrictItem', id: '10', listId: '1', name: 'Incomplete' },
      });
      await sleep(5);

      await testWithClient(client, async () => {
        class GetStrictList extends RESTQuery {
          params = { id: t.id };
          path = `/strictlist/${this.params.id}`;
          result = { list: t.entity(StrictList) };
        }

        const relay = fetchQuery(GetStrictList, { id: '1' });
        await relay;
        expect(relay.value!.list.items).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // 8. Constraint matcher nested paths
  // ============================================================

  describe('constraint matcher nested paths', () => {
    it('computeConstraintHash resolves nested dotted paths', () => {
      const data = { meta: { listId: '1' }, name: 'test' };
      const hash = computeConstraintHash(data, buildFieldPaths(['meta.listId']));
      expect(hash).toBeDefined();

      const dataNoMatch = { meta: { listId: '2' }, name: 'test' };
      const hash2 = computeConstraintHash(dataNoMatch, buildFieldPaths(['meta.listId']));
      expect(hash2).toBeDefined();
      expect(hash).not.toBe(hash2);
    });

    it('returns undefined for missing nested path', () => {
      const data = { meta: {}, name: 'test' };
      const hash = computeConstraintHash(data, buildFieldPaths(['meta.listId']));
      expect(hash).toBeUndefined();
    });

    it('returns undefined when intermediate is null', () => {
      const data = { meta: null, name: 'test' } as any;
      const hash = computeConstraintHash(data, buildFieldPaths(['meta.listId']));
      expect(hash).toBeUndefined();
    });
  });

  // ============================================================
  // 9. Sorted live arrays
  // ============================================================

  describe('sorted live arrays', () => {
    it('items are sorted on initial load', async () => {
      class SItem extends Entity {
        __typename = t.typename('SItem');
        id = t.id;
        listId = t.string;
        name = t.string;
        order = t.number;
      }

      class SList extends Entity {
        __typename = t.typename('SList');
        id = t.id;
        items = t.liveArray(SItem, {
          constraints: { listId: (this as any).id },
          sort: (a: any, b: any) => a.order - b.order,
        });
      }

      mockFetch.get('/slist/[id]', {
        list: {
          __typename: 'SList',
          id: '1',
          items: [
            { __typename: 'SItem', id: '3', listId: '1', name: 'C', order: 3 },
            { __typename: 'SItem', id: '1', listId: '1', name: 'A', order: 1 },
            { __typename: 'SItem', id: '2', listId: '1', name: 'B', order: 2 },
          ],
        },
      });

      await testWithClient(client, async () => {
        class GetSList extends RESTQuery {
          params = { id: t.id };
          path = `/slist/${this.params.id}`;
          result = { list: t.entity(SList) };
        }

        const relay = fetchQuery(GetSList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);

        const names = items().map((i: any) => i.name);
        expect(names).toEqual(['A', 'B', 'C']);
      });
    });

    it('items remain sorted after add/remove events', async () => {
      class SItem2 extends Entity {
        __typename = t.typename('SItem2');
        id = t.id;
        listId = t.string;
        name = t.string;
        order = t.number;
      }

      class SList2 extends Entity {
        __typename = t.typename('SList2');
        id = t.id;
        items = t.liveArray(SItem2, {
          constraints: { listId: (this as any).id },
          sort: (a: any, b: any) => a.order - b.order,
        });
      }

      mockFetch.get('/slist2/[id]', {
        list: {
          __typename: 'SList2',
          id: '1',
          items: [
            { __typename: 'SItem2', id: '1', listId: '1', name: 'A', order: 1 },
            { __typename: 'SItem2', id: '3', listId: '1', name: 'C', order: 3 },
          ],
        },
      });

      await testWithClient(client, async () => {
        class GetSList2 extends RESTQuery {
          params = { id: t.id };
          path = `/slist2/${this.params.id}`;
          result = { list: t.entity(SList2) };
        }

        const relay = fetchQuery(GetSList2, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);

        expect(items().map((i: any) => i.name)).toEqual(['A', 'C']);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'SItem2',
          data: { __typename: 'SItem2', id: '2', listId: '1', name: 'B', order: 2 },
        });

        expect(items().map((i: any) => i.name)).toEqual(['A', 'B', 'C']);

        await applyEventOutsideReactiveContext(client, {
          type: 'delete',
          typename: 'SItem2',
          data: '1',
        });

        expect(items().map((i: any) => i.name)).toEqual(['B', 'C']);
      });
    });
  });

  // ============================================================
  // 10. LiveCollectionBinding.destroy()
  // ============================================================

  describe('LiveCollectionBinding.destroy()', () => {
    it('destroy stops events from routing to the binding', async () => {
      class DItem extends Entity {
        __typename = t.typename('DItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class DList extends Entity {
        __typename = t.typename('DList');
        id = t.id;
        items = t.liveArray(DItem, { constraints: { listId: (this as any).id } });
      }

      mockFetch.get('/dlist/[id]', {
        list: {
          __typename: 'DList',
          id: '1',
          items: [{ __typename: 'DItem', id: '1', listId: '1', name: 'A' }],
        },
      });

      let itemsSnapshot: any[] = [];

      await testWithClient(client, async () => {
        class GetDList extends RESTQuery {
          params = { id: t.id };
          path = `/dlist/${this.params.id}`;
          result = { list: t.entity(DList) };
        }

        const relay = fetchQuery(GetDList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(1);
        itemsSnapshot = items();
      });

      // After watcher cleanup, create a new item via mutation
      client.applyMutationEvent({
        type: 'create',
        typename: 'DItem',
        data: { __typename: 'DItem', id: '2', listId: '1', name: 'B' },
      });
      await sleep(10);

      // Re-fetch and check: the new event should route to a fresh binding
      await testWithClient(client, async () => {
        class GetDList extends RESTQuery {
          params = { id: t.id };
          path = `/dlist/${this.params.id}`;
          result = { list: t.entity(DList) };
        }

        const relay = fetchQuery(GetDList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(2);
      });
    });
  });

  // ============================================================
  // 11. Duplicate create events (idempotency)
  // ============================================================

  describe('duplicate create events', () => {
    it('two create events for same entity key produce only 1 entry', async () => {
      class DupItem extends Entity {
        __typename = t.typename('DupItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class DupList extends Entity {
        __typename = t.typename('DupList');
        id = t.id;
        items = t.liveArray(DupItem, { constraints: { listId: (this as any).id } });
      }

      mockFetch.get('/duplist/[id]', {
        list: {
          __typename: 'DupList',
          id: '1',
          items: [],
        },
      });

      await testWithClient(client, async () => {
        class GetDupList extends RESTQuery {
          params = { id: t.id };
          path = `/duplist/${this.params.id}`;
          result = { list: t.entity(DupList) };
        }

        const relay = fetchQuery(GetDupList, { id: '1' });
        await relay;
        const list = relay.value!.list;
        const items = reactive(() => list.items);
        expect(items()).toHaveLength(0);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'DupItem',
          data: { __typename: 'DupItem', id: 'x', listId: '1', name: 'X' },
        });

        expect(items()).toHaveLength(1);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'DupItem',
          data: { __typename: 'DupItem', id: 'x', listId: '1', name: 'X' },
        });

        expect(items()).toHaveLength(1);
      });
    });
  });

  // ============================================================
  // 12. withRetry validation
  // ============================================================

  describe('withRetry validation', () => {
    it('negative retries throws in dev mode', async () => {
      await expect(withRetry(async () => 'ok', { retries: -1, retryDelay: () => 0 })).rejects.toThrow(
        'retries must be non-negative',
      );
    });

    it('zero retries runs the function once', async () => {
      let callCount = 0;
      const result = await withRetry(
        async () => {
          callCount++;
          return 'success';
        },
        { retries: 0, retryDelay: () => 0 },
      );
      expect(result).toBe('success');
      expect(callCount).toBe(1);
    });
  });

  // ============================================================
  // 13. Lazy constraint filtering
  // ============================================================

  describe('lazy constraint filtering', () => {
    it('entity changing constraint field disappears from original list', async () => {
      class LItem extends Entity {
        __typename = t.typename('LItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class LList extends Entity {
        __typename = t.typename('LList');
        id = t.id;
        items = t.liveArray(LItem, { constraints: { listId: (this as any).id } });
      }

      mockFetch.get('/llist/[id]', {
        list: {
          __typename: 'LList',
          id: '1',
          items: [{ __typename: 'LItem', id: 'a', listId: '1', name: 'Alpha' }],
        },
      });
      mockFetch.get('/llist/[id]', {
        list: {
          __typename: 'LList',
          id: '2',
          items: [],
        },
      });

      await testWithClient(client, async () => {
        class GetLList extends RESTQuery {
          params = { id: t.id };
          path = `/llist/${this.params.id}`;
          result = { list: t.entity(LList) };
        }

        const relay1 = fetchQuery(GetLList, { id: '1' });
        await relay1;
        const list1 = relay1.value!.list;
        const items1 = reactive(() => list1.items);
        expect(items1()).toHaveLength(1);

        const relay2 = fetchQuery(GetLList, { id: '2' });
        await relay2;
        const list2 = relay2.value!.list;
        const items2 = reactive(() => list2.items);
        expect(items2()).toHaveLength(0);

        // Update the entity's listId from '1' to '2'
        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'LItem',
          data: { __typename: 'LItem', id: 'a', listId: '2', name: 'Alpha' },
        });

        // The item should now appear in list 2 and disappear from list 1's
        // filtered view on next access
        expect(items2()).toHaveLength(1);
        expect(items2()[0].name).toBe('Alpha');

        // List 1's output signal should filter it out since listId no longer matches
        expect(items1()).toHaveLength(0);
      });
    });
  });
});
