import { describe, it, expect, beforeEach } from 'vitest';
import { NormalizedDocumentStore, MemoryPersistentStore } from '../documentStore.js';
import { QueryClient, entity, t, parseEntities } from '../client.js';
import { hashValue } from 'signalium/utils';

describe('Parse Entities', () => {
  let kv: MemoryPersistentStore;
  let store: NormalizedDocumentStore;
  let client: QueryClient;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new NormalizedDocumentStore(kv);
    client = new QueryClient(kv, store, { fetch: fetch });
  });

  describe('nested entities', () => {
    it('should track refs for deeply nested entities (A->B->C)', async () => {
      const EntityC = entity('EntityC', () => ({
        id: t.number,
        name: t.string,
      }));

      const EntityB = entity('EntityB', () => ({
        id: t.number,
        name: t.string,
        c: EntityC,
      }));

      const EntityA = entity('EntityA', () => ({
        id: t.number,
        name: t.string,
        b: EntityB,
      }));

      const QueryResult = t.object({
        data: EntityA,
      });

      const result = {
        data: {
          __typename: 'EntityA',
          id: 1,
          name: 'A',
          b: {
            __typename: 'EntityB',
            id: 2,
            name: 'B',
            c: {
              __typename: 'EntityC',
              id: 3,
              name: 'C',
            },
          },
        },
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Top-level object is not an entity, so it pushes EntityA's key up
      expect(entityRefs.length).toBe(1);

      // Get the keys for each entity
      const keyA = hashValue('EntityA:1');
      const keyB = hashValue('EntityB:2');
      const keyC = hashValue('EntityC:3');

      expect(entityRefs[0]).toBe(keyA);

      // EntityA should reference only EntityB (immediate child)
      const refsA = await kv.getBuffer(`sq:doc:refIds:${keyA}`);
      expect(refsA).toBeDefined();
      const refsAArray = Array.from(refsA!);
      expect(refsAArray).toContain(keyB);
      expect(refsAArray).not.toContain(keyC); // Not transitive
      expect(refsAArray.length).toBe(1);

      // EntityB should reference only EntityC (immediate child)
      const refsB = await kv.getBuffer(`sq:doc:refIds:${keyB}`);
      expect(refsB).toBeDefined();
      const refsBArray = Array.from(refsB!);
      expect(refsBArray).toContain(keyC);
      expect(refsBArray.length).toBe(1);

      // EntityC should have no refs (leaf node)
      const refsC = await kv.getBuffer(`sq:doc:refIds:${keyC}`);
      expect(refsC).toBeUndefined();
    });

    it('should track refs for sibling entities (A->[B,C])', async () => {
      const EntityB = entity('EntityB', () => ({
        id: t.number,
        name: t.string,
      }));

      const EntityC = entity('EntityC', () => ({
        id: t.number,
        name: t.string,
      }));

      const EntityA = entity('EntityA', () => ({
        id: t.number,
        name: t.string,
        b: EntityB,
        c: EntityC,
      }));

      const QueryResult = t.object({
        data: EntityA,
      });

      const result = {
        data: {
          __typename: 'EntityA',
          id: 1,
          name: 'A',
          b: {
            __typename: 'EntityB',
            id: 2,
            name: 'B',
          },
          c: {
            __typename: 'EntityC',
            id: 3,
            name: 'C',
          },
        },
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Top-level object is not an entity, so it pushes EntityA's key up
      expect(entityRefs.length).toBe(1);

      const keyA = hashValue('EntityA:1');
      const keyB = hashValue('EntityB:2');
      const keyC = hashValue('EntityC:3');

      expect(entityRefs[0]).toBe(keyA);

      // EntityA should reference both B and C (immediate children)
      const refsA = await kv.getBuffer(`sq:doc:refIds:${keyA}`);
      expect(refsA).toBeDefined();
      const refsAArray = Array.from(refsA!);
      expect(refsAArray).toContain(keyB);
      expect(refsAArray).toContain(keyC);
      expect(refsAArray.length).toBe(2);
    });
  });

  describe('entities in collections', () => {
    it('should track refs for entities in arrays', async () => {
      const EntityItem = entity('EntityItem', () => ({
        id: t.number,
        name: t.string,
      }));

      const QueryResult = t.object({
        items: t.array(EntityItem),
      });

      const result = {
        items: [
          { __typename: 'EntityItem', id: 1, name: 'Item1' },
          { __typename: 'EntityItem', id: 2, name: 'Item2' },
          { __typename: 'EntityItem', id: 3, name: 'Item3' },
        ],
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Top-level object is not an entity, and arrays push their entity children up
      // So entityRefs should have the three entity keys
      expect(entityRefs.length).toBe(3);

      const key1 = hashValue('EntityItem:1');
      const key2 = hashValue('EntityItem:2');
      const key3 = hashValue('EntityItem:3');

      expect(entityRefs).toContain(key1);
      expect(entityRefs).toContain(key2);
      expect(entityRefs).toContain(key3);

      // Each entity should be stored
      expect(await store.get(key1)).toBeDefined();
      expect(await store.get(key2)).toBeDefined();
      expect(await store.get(key3)).toBeDefined();

      // None of the leaf entities should have refs
      expect(await kv.getBuffer(`sq:doc:refIds:${key1}`)).toBeUndefined();
      expect(await kv.getBuffer(`sq:doc:refIds:${key2}`)).toBeUndefined();
      expect(await kv.getBuffer(`sq:doc:refIds:${key3}`)).toBeUndefined();
    });

    it('should track refs for entities in records', async () => {
      const EntityValue = entity('EntityValue', () => ({
        id: t.number,
        value: t.string,
      }));

      const QueryResult = t.object({
        map: t.record(EntityValue),
      });

      const result = {
        map: {
          a: { __typename: 'EntityValue', id: 1, value: 'A' },
          b: { __typename: 'EntityValue', id: 2, value: 'B' },
          c: { __typename: 'EntityValue', id: 3, value: 'C' },
        },
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Top-level object is not an entity, records push their entity children up
      expect(entityRefs.length).toBe(3);

      const key1 = hashValue('EntityValue:1');
      const key2 = hashValue('EntityValue:2');
      const key3 = hashValue('EntityValue:3');

      expect(entityRefs).toContain(key1);
      expect(entityRefs).toContain(key2);
      expect(entityRefs).toContain(key3);

      // None of the leaf entities should have refs
      expect(await kv.getBuffer(`sq:doc:refIds:${key1}`)).toBeUndefined();
      expect(await kv.getBuffer(`sq:doc:refIds:${key2}`)).toBeUndefined();
      expect(await kv.getBuffer(`sq:doc:refIds:${key3}`)).toBeUndefined();
    });

    it('should handle nested entities in arrays', async () => {
      const EntityChild = entity('EntityChild', () => ({
        id: t.number,
        name: t.string,
      }));

      const EntityParent = entity('EntityParent', () => ({
        id: t.number,
        name: t.string,
        child: EntityChild,
      }));

      const QueryResult = t.object({
        items: t.array(EntityParent),
      });

      const result = {
        items: [
          {
            __typename: 'EntityParent',
            id: 1,
            name: 'Parent1',
            child: { __typename: 'EntityChild', id: 10, name: 'Child10' },
          },
          {
            __typename: 'EntityParent',
            id: 2,
            name: 'Parent2',
            child: { __typename: 'EntityChild', id: 20, name: 'Child20' },
          },
        ],
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Should have parent keys
      expect(entityRefs.length).toBe(2);

      const keyP1 = hashValue('EntityParent:1');
      const keyP2 = hashValue('EntityParent:2');
      const keyC10 = hashValue('EntityChild:10');
      const keyC20 = hashValue('EntityChild:20');

      expect(entityRefs).toContain(keyP1);
      expect(entityRefs).toContain(keyP2);

      // Parent1 should reference Child10
      const refsP1 = await kv.getBuffer(`sq:doc:refIds:${keyP1}`);
      expect(refsP1).toBeDefined();
      expect(Array.from(refsP1!)).toContain(keyC10);

      // Parent2 should reference Child20
      const refsP2 = await kv.getBuffer(`sq:doc:refIds:${keyP2}`);
      expect(refsP2).toBeDefined();
      expect(Array.from(refsP2!)).toContain(keyC20);
    });
  });

  describe('shared entities', () => {
    it('should handle same entity referenced multiple times', async () => {
      const EntityShared = entity('EntityShared', () => ({
        id: t.number,
        name: t.string,
      }));

      const EntityContainer = entity('EntityContainer', () => ({
        id: t.number,
        first: EntityShared,
        second: EntityShared,
      }));

      const QueryResult = t.object({
        data: EntityContainer,
      });

      const sharedEntity = {
        __typename: 'EntityShared',
        id: 99,
        name: 'Shared',
      };

      const result = {
        data: {
          __typename: 'EntityContainer',
          id: 1,
          first: sharedEntity,
          second: sharedEntity,
        },
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      // Top-level object pushes Container's key
      expect(entityRefs.length).toBe(1);

      const keyContainer = hashValue('EntityContainer:1');
      const keyShared = hashValue('EntityShared:99');

      expect(entityRefs[0]).toBe(keyContainer);

      // Container should reference the shared entity
      const refsContainer = await kv.getBuffer(`sq:doc:refIds:${keyContainer}`);
      expect(refsContainer).toBeDefined();
      const refsArray = Array.from(refsContainer!).filter(k => k !== 0);

      // The refs array may contain duplicates (first, second both point to same entity)
      // But that's ok - the important part is the ref count is correct
      expect(refsArray).toContain(keyShared);

      // Ref count should be 1 (documentStore deduplicates when processing refs)
      const refCount = await kv.getNumber(`sq:doc:refCount:${keyShared}`);
      expect(refCount).toBe(1);
    });
  });

  describe('complex structures', () => {
    it('should handle entity with array of nested entities', async () => {
      const EntityTag = entity('EntityTag', () => ({
        id: t.number,
        label: t.string,
      }));

      const EntityPost = entity('EntityPost', () => ({
        id: t.number,
        title: t.string,
        tags: t.array(EntityTag),
      }));

      const QueryResult = t.object({
        post: EntityPost,
      });

      const result = {
        post: {
          __typename: 'EntityPost',
          id: 1,
          title: 'My Post',
          tags: [
            { __typename: 'EntityTag', id: 10, label: 'tech' },
            { __typename: 'EntityTag', id: 20, label: 'coding' },
          ],
        },
      };

      const entityRefs: number[] = [];
      await parseEntities(result, QueryResult, client, entityRefs);

      const keyPost = hashValue('EntityPost:1');
      const keyTag10 = hashValue('EntityTag:10');
      const keyTag20 = hashValue('EntityTag:20');

      // Post should reference both tags
      const refsPost = await kv.getBuffer(`sq:doc:refIds:${keyPost}`);
      expect(refsPost).toBeDefined();
      const refsArray = Array.from(refsPost!);
      expect(refsArray).toContain(keyTag10);
      expect(refsArray).toContain(keyTag20);
      expect(refsArray.length).toBe(2);
    });
  });
});
