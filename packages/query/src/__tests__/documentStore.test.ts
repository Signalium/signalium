import { describe, it, expect, beforeEach } from 'vitest';
import { NormalizedDocumentStore, MemoryPersistentStore } from '../documentStore.js';

describe('NormalizedDocumentStore', () => {
  let kv: MemoryPersistentStore;
  let store: NormalizedDocumentStore;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new NormalizedDocumentStore(kv);
  });

  describe('basic operations', () => {
    it('should store and retrieve a document', async () => {
      await store.set(1, { name: 'test' });
      const result = await store.get(1);
      expect(result).toEqual({ name: 'test' });
    });

    it('should return undefined for non-existent document', async () => {
      const result = await store.get(999);
      expect(result).toBeUndefined();
    });

    it('should delete a document', async () => {
      await store.set(1, { name: 'test' });
      await store.delete(1);
      const result = await store.get(1);
      expect(result).toBeUndefined();
    });
  });

  describe('reference counting', () => {
    it('should increment ref count when adding a reference', async () => {
      // Document 1 references document 2
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));

      const refCount = await kv.getNumber('sq:doc:refCount:2');
      expect(refCount).toBe(1);
    });

    it('should handle multiple documents referencing the same entity', async () => {
      // Document 1 and 3 both reference document 2
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));
      await store.set(3, { data: 'doc3' }, new Uint32Array([2]));

      const refCount = await kv.getNumber('sq:doc:refCount:2');
      expect(refCount).toBe(2);
    });

    it('should delete ref count when removing a reference', async () => {
      // Document 1 references document 2
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));
      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(1);

      // Update document 1 to not reference document 2
      await store.set(1, { data: 'doc1-updated' }, new Uint32Array([]));

      const refCount = await kv.getNumber('sq:doc:refCount:2');
      expect(refCount).toBe(undefined);
    });

    it('should keep ref count when reference is maintained during update', async () => {
      // Document 1 references document 2
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));
      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(1);

      // Update document 1 but keep reference to document 2
      await store.set(1, { data: 'doc1-updated' }, new Uint32Array([2]));

      const refCount = await kv.getNumber('sq:doc:refCount:2');
      expect(refCount).toBe(1); // Should stay at 1, not increment to 2
    });

    it('should handle updating references (add new, remove old)', async () => {
      // Document 1 references document 2
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));
      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(1);

      // Update document 1 to reference document 3 instead
      await store.set(1, { data: 'doc1-updated' }, new Uint32Array([3]));

      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(undefined); // Doc 2 no longer referenced, count deleted
      expect(await kv.getNumber('sq:doc:refCount:3')).toBe(1); // Doc 3 now referenced
    });
  });

  describe('cascading deletes', () => {
    it('should cascade delete when ref count reaches zero', async () => {
      // Setup: Entity 2 exists, Document 1 references it
      await store.set(2, { entity: 'data' });
      await store.set(1, { query: 'result' }, new Uint32Array([2]));

      expect(await store.get(2)).toEqual({ entity: 'data' });

      // Delete document 1 (the only thing referencing entity 2)
      await store.delete(1);

      // Entity 2 should be cascade deleted (ref count reached 0)
      expect(await store.get(2)).toBeUndefined();
      expect(await kv.getNumber('sq:doc:refCount:2')).toBeUndefined();
    });

    it('should NOT delete entity if still referenced by another document', async () => {
      // Setup: Entity 2 exists, Documents 1 and 3 both reference it
      await store.set(2, { entity: 'data' });
      await store.set(1, { query: 'result1' }, new Uint32Array([2]));
      await store.set(3, { query: 'result2' }, new Uint32Array([2]));

      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(2);

      // Delete document 1
      await store.delete(1);

      // Entity 2 should still exist (still referenced by document 3)
      expect(await store.get(2)).toEqual({ entity: 'data' });
      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(1);
    });

    it('should handle deep cascading deletes (A->B->C)', async () => {
      // Setup: Query -> Entity B -> Entity C
      await store.set(3, { entityC: 'data' }); // Entity C
      await store.set(2, { entityB: 'data' }, new Uint32Array([3])); // Entity B refs C
      await store.set(1, { query: 'result' }, new Uint32Array([2])); // Query refs B

      // All should exist
      expect(await store.get(1)).toBeDefined();
      expect(await store.get(2)).toBeDefined();
      expect(await store.get(3)).toBeDefined();

      // Delete the query
      await store.delete(1);

      // All should be cascade deleted
      expect(await store.get(1)).toBeUndefined();
      expect(await store.get(2)).toBeUndefined();
      expect(await store.get(3)).toBeUndefined();
    });

    it('should handle diamond dependencies (A->B,C and B,C->D)', async () => {
      // Setup:
      //   Query(1)
      //   /     \
      // B(2)   C(3)
      //   \     /
      //    D(4)
      await store.set(4, { entityD: 'data' }); // Entity D
      await store.set(2, { entityB: 'data' }, new Uint32Array([4])); // B refs D
      await store.set(3, { entityC: 'data' }, new Uint32Array([4])); // C refs D
      await store.set(1, { query: 'result' }, new Uint32Array([2, 3])); // Query refs B and C

      expect(await kv.getNumber('sq:doc:refCount:4')).toBe(2); // D referenced by B and C

      // Delete the query - should delete B and C, but D should survive with refCount 0
      // Wait, actually both B and C will be deleted, and each will decrement D's count
      await store.delete(1);

      expect(await store.get(1)).toBeUndefined();
      expect(await store.get(2)).toBeUndefined();
      expect(await store.get(3)).toBeUndefined();
      expect(await store.get(4)).toBeUndefined(); // D should also be deleted
    });
  });

  describe('edge cases', () => {
    it('should handle deleting a document with no references', async () => {
      await store.set(1, { data: 'test' });
      await store.delete(1);

      expect(await store.get(1)).toBeUndefined();
    });

    it('should handle setting references to undefined (clearing refs)', async () => {
      await store.set(1, { data: 'doc1' }, new Uint32Array([2]));
      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(1);

      await store.set(1, { data: 'doc1-updated' }, undefined);

      expect(await kv.getNumber('sq:doc:refCount:2')).toBe(undefined);
      expect(await kv.getBuffer('sq:doc:refIds:1')).toBeUndefined();
    });

    it('should handle multiple references to the same entity in one document', async () => {
      // Document 1 references entity 2 multiple times
      // This could happen if an entity appears in multiple places in a query result
      await store.set(1, { data: 'doc1' }, new Uint32Array([2, 2, 2]));

      // Should only increment once - we treat refs as a set (logical reference)
      const refCount = await kv.getNumber('sq:doc:refCount:2');
      expect(refCount).toBe(1);
    });
  });

  describe('storage cleanup', () => {
    it('should clean up refIds when deleting a document', async () => {
      await store.set(1, { data: 'doc1' }, new Uint32Array([2, 3]));

      // Verify refIds are stored
      expect(await kv.getBuffer('sq:doc:refIds:1')).toBeDefined();

      await store.delete(1);

      // refIds should be deleted
      expect(await kv.getBuffer('sq:doc:refIds:1')).toBeUndefined();
    });

    it('should clean up all keys when cascade deleting', async () => {
      await store.set(2, { entity: 'data' });
      await store.set(1, { query: 'result' }, new Uint32Array([2]));

      await store.delete(1);

      // All keys for both documents should be cleaned up
      expect(await kv.getString('sq:doc:value:1')).toBeUndefined();
      expect(await kv.getNumber('sq:doc:refCount:1')).toBeUndefined();
      expect(await kv.getBuffer('sq:doc:refIds:1')).toBeUndefined();

      expect(await kv.getString('sq:doc:value:2')).toBeUndefined();
      expect(await kv.getNumber('sq:doc:refCount:2')).toBeUndefined();
      expect(await kv.getBuffer('sq:doc:refIds:2')).toBeUndefined();
    });
  });
});
