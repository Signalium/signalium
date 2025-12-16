import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncQueryStore, AsyncPersistentStore, StoreMessage } from '../stores/async.js';
import { valueKeyFor, refCountKeyFor, refIdsKeyFor, updatedAtKeyFor, queueKeyFor } from '../stores/shared.js';
import { entity, t } from '../typeDefs.js';
import { query, queryKeyForFn } from '../query.js';
import { hashValue } from 'signalium/utils';
import { createMockFetch, sleep } from './utils.js';

/**
 * AsyncQueryStore Tests
 *
 * Tests async query store with reader-writer pattern, message passing,
 * and serial queue processing.
 */

// Mock async persistent store for testing
class MockAsyncPersistentStore implements AsyncPersistentStore {
  private readonly kv: Record<string, unknown> = Object.create(null);

  async has(key: string): Promise<boolean> {
    return key in this.kv;
  }

  async getString(key: string): Promise<string | undefined> {
    return this.kv[key] as string | undefined;
  }

  async setString(key: string, value: string): Promise<void> {
    this.kv[key] = value;
  }

  async getNumber(key: string): Promise<number | undefined> {
    return this.kv[key] as number | undefined;
  }

  async setNumber(key: string, value: number): Promise<void> {
    this.kv[key] = value;
  }

  async getBuffer(key: string): Promise<Uint32Array | undefined> {
    return this.kv[key] as Uint32Array | undefined;
  }

  async setBuffer(key: string, value: Uint32Array): Promise<void> {
    this.kv[key] = value;
  }

  async delete(key: string): Promise<void> {
    delete this.kv[key];
  }

  // Test helper: get all keys
  getAllKeys(): string[] {
    return Object.keys(this.kv);
  }

  // Test helper: clear all data
  clear(): void {
    for (const key in this.kv) {
      delete this.kv[key];
    }
  }
}

// Message channel simulator for testing reader-writer communication
class MessageChannel {
  private writerHandler?: (msg: StoreMessage) => void;
  private readerHandler?: (msg: StoreMessage) => void;

  connectWriter(handler: (msg: StoreMessage) => void) {
    this.writerHandler = handler;
    return {
      sendMessage: (msg: StoreMessage) => {
        // Reader sends to writer
        if (this.writerHandler) {
          this.writerHandler(msg);
        }
      },
    };
  }

  connectReader(handler: (msg: StoreMessage) => void) {
    this.readerHandler = handler;
    return {
      sendMessage: (msg: StoreMessage) => {
        // In this test setup, readers send to writer
        if (this.writerHandler) {
          this.writerHandler(msg);
        }
      },
    };
  }
}

describe('AsyncQueryStore', () => {
  let writerStore: AsyncQueryStore;
  let readerStore: AsyncQueryStore;
  let mockDelegate: MockAsyncPersistentStore;
  let messageChannel: MessageChannel;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    mockDelegate = new MockAsyncPersistentStore();
    messageChannel = new MessageChannel();

    // Create writer store
    writerStore = new AsyncQueryStore({
      isWriter: true,
      delegate: mockDelegate,
      connect: handler => messageChannel.connectWriter(handler),
    });

    // Create reader store
    readerStore = new AsyncQueryStore({
      isWriter: false,
      delegate: mockDelegate, // Reader also needs delegate for reads
      connect: handler => messageChannel.connectReader(handler),
    });

    mockFetch = createMockFetch();
  });

  describe('Writer Configuration', () => {
    it('should require delegate for writer', () => {
      expect(() => {
        new AsyncQueryStore({
          isWriter: true,
          connect: handler => ({ sendMessage: () => {} }),
        });
      }).toThrow('Writer must have a delegate');
    });

    it('should not require delegate for reader', () => {
      expect(() => {
        new AsyncQueryStore({
          isWriter: false,
          connect: handler => ({ sendMessage: () => {} }),
        });
      }).not.toThrow();
    });
  });

  describe('Message Queue Processing', () => {
    it('should process saveQuery messages serially', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      const queryDefId = 'GET:/users/[id]';
      const queryKey1 = queryKeyForFn(getUser, { id: '1' });
      const queryKey2 = queryKeyForFn(getUser, { id: '2' });

      const user1 = { id: '1', name: 'Alice' };
      const user2 = { id: '2', name: 'Bob' };

      // Send multiple messages
      writerStore.saveQuery({ id: queryDefId } as any, queryKey1, user1, Date.now());
      writerStore.saveQuery({ id: queryDefId } as any, queryKey2, user2, Date.now());

      // Wait for queue to process
      await sleep(100);

      // Verify both were saved
      const savedUser1 = await mockDelegate.getString(valueKeyFor(queryKey1));
      const savedUser2 = await mockDelegate.getString(valueKeyFor(queryKey2));

      expect(JSON.parse(savedUser1!)).toEqual(user1);
      expect(JSON.parse(savedUser2!)).toEqual(user2);
    });

    it('should process saveEntity messages', async () => {
      const entityKey = 12345;
      const entityValue = { id: '1', name: 'Test Entity' };

      writerStore.saveEntity(entityKey, entityValue);

      // Wait for queue to process
      await sleep(100);

      const saved = await mockDelegate.getString(valueKeyFor(entityKey));
      expect(JSON.parse(saved!)).toEqual(entityValue);
    });

    it('should process activateQuery messages', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);

      // First save a query so it can be activated
      await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify({ id: '1', name: 'Alice' }));
      await mockDelegate.setNumber(updatedAtKeyFor(queryKey), Date.now());

      writerStore.activateQuery({ id: queryDefId } as any, queryKey);

      // Wait for queue to process
      await sleep(100);

      // Verify queue was created and query was added
      const queue = await mockDelegate.getBuffer(queueKeyFor(queryDefId));
      expect(queue).toBeDefined();
      expect(queue![0]).toBe(queryKey);
    });
  });

  describe('Reader-Writer Communication', () => {
    it('should send messages from reader to writer', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);
      const user = { id: '1', name: 'Alice' };
      const now = Date.now();

      // Reader sends save message
      readerStore.saveQuery({ id: queryDefId } as any, queryKey, user, now);

      // Wait for writer to process
      await sleep(100);

      // Verify writer saved the data
      const saved = await mockDelegate.getString(valueKeyFor(queryKey));
      expect(JSON.parse(saved!)).toEqual(user);

      const savedTime = await mockDelegate.getNumber(updatedAtKeyFor(queryKey));
      expect(savedTime).toBe(now);
    });

    it('should handle entity saves from reader', async () => {
      const entityKey = 99999;
      const entityValue = { id: '99', type: 'entity' };

      // Reader sends entity save
      readerStore.saveEntity(entityKey, entityValue);

      // Wait for writer to process
      await sleep(100);

      // Verify writer saved it
      const saved = await mockDelegate.getString(valueKeyFor(entityKey));
      expect(JSON.parse(saved!)).toEqual(entityValue);
    });
  });

  describe('Reference Counting', () => {
    it('should increment ref counts when saving with refIds', async () => {
      const queryKey = 1;
      const entityId1 = 100;
      const entityId2 = 200;

      writerStore.saveQuery(
        { id: 'test' } as any,
        queryKey,
        { data: 'test' },
        Date.now(),
        new Set([entityId1, entityId2]),
      );

      await sleep(100);

      const refCount1 = await mockDelegate.getNumber(refCountKeyFor(entityId1));
      const refCount2 = await mockDelegate.getNumber(refCountKeyFor(entityId2));

      expect(refCount1).toBe(1);
      expect(refCount2).toBe(1);
    });

    it('should decrement ref counts when updating refIds', async () => {
      const queryKey = 1;
      const entityId1 = 100;
      const entityId2 = 200;
      const entityId3 = 300;

      // First save with entityId1 and entityId2
      writerStore.saveQuery(
        { id: 'test' } as any,
        queryKey,
        { data: 'v1' },
        Date.now(),
        new Set([entityId1, entityId2]),
      );
      await sleep(100);

      expect(await mockDelegate.getNumber(refCountKeyFor(entityId1))).toBe(1);
      expect(await mockDelegate.getNumber(refCountKeyFor(entityId2))).toBe(1);

      // Update to only entityId2 and entityId3
      writerStore.saveQuery(
        { id: 'test' } as any,
        queryKey,
        { data: 'v2' },
        Date.now(),
        new Set([entityId2, entityId3]),
      );
      await sleep(100);

      // entityId1 should be decremented to 0 (deleted)
      expect(await mockDelegate.getNumber(refCountKeyFor(entityId1))).toBeUndefined();
      // entityId2 should still be 1
      expect(await mockDelegate.getNumber(refCountKeyFor(entityId2))).toBe(1);
      // entityId3 should be incremented to 1
      expect(await mockDelegate.getNumber(refCountKeyFor(entityId3))).toBe(1);
    });

    it('should cascade delete when ref count reaches zero', async () => {
      const parentKey = 1;
      const childKey = 100;

      // Save child entity
      await mockDelegate.setString(valueKeyFor(childKey), JSON.stringify({ id: 'child' }));

      // Save parent with ref to child
      writerStore.saveQuery({ id: 'test' } as any, parentKey, { data: 'parent' }, Date.now(), new Set([childKey]));
      await sleep(100);

      expect(await mockDelegate.getNumber(refCountKeyFor(childKey))).toBe(1);
      expect(await mockDelegate.getString(valueKeyFor(childKey))).toBeDefined();

      // Remove ref to child
      writerStore.saveQuery({ id: 'test' } as any, parentKey, { data: 'parent-updated' }, Date.now(), new Set());
      await sleep(100);

      // Child should be cascade deleted
      expect(await mockDelegate.getNumber(refCountKeyFor(childKey))).toBeUndefined();
      expect(await mockDelegate.getString(valueKeyFor(childKey))).toBeUndefined();
    });
  });

  describe('LRU Queue Management', () => {
    it('should add queries to the LRU queue', async () => {
      const queryDefId = 'GET:/users';
      const queryKey = hashValue([queryDefId, undefined]);

      await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify({ users: [] }));

      writerStore.activateQuery({ id: queryDefId } as any, queryKey);
      await sleep(100);

      const queue = await mockDelegate.getBuffer(queueKeyFor(queryDefId));
      expect(queue).toBeDefined();
      expect(queue![0]).toBe(queryKey);
    });

    it('should evict oldest query when cache is full', async () => {
      const queryDefId = 'GET:/users/[id]';

      // Create a small cache (we'll use default 50, but add 51 items)
      const queries: number[] = [];
      for (let i = 0; i < 51; i++) {
        const queryKey = hashValue([queryDefId, { id: String(i) }]);
        queries.push(queryKey);
        await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify({ id: String(i) }));
        await mockDelegate.setNumber(updatedAtKeyFor(queryKey), Date.now());
      }

      // Activate all queries
      for (const queryKey of queries) {
        writerStore.activateQuery({ id: queryDefId, cache: { maxCount: 50 } } as any, queryKey);
      }

      await sleep(200);

      // The first query (index 0) should have been evicted
      const firstQueryExists = await mockDelegate.has(valueKeyFor(queries[0]));
      expect(firstQueryExists).toBe(false);

      // The last query should still exist
      const lastQueryExists = await mockDelegate.has(valueKeyFor(queries[50]));
      expect(lastQueryExists).toBe(true);
    });

    it('should move accessed query to front of LRU queue', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey1 = hashValue([queryDefId, { id: '1' }]);
      const queryKey2 = hashValue([queryDefId, { id: '2' }]);

      await mockDelegate.setString(valueKeyFor(queryKey1), JSON.stringify({ id: '1' }));
      await mockDelegate.setString(valueKeyFor(queryKey2), JSON.stringify({ id: '2' }));

      // Activate query 1, then query 2
      writerStore.activateQuery({ id: queryDefId } as any, queryKey1);
      await sleep(50);
      writerStore.activateQuery({ id: queryDefId } as any, queryKey2);
      await sleep(50);

      let queue = await mockDelegate.getBuffer(queueKeyFor(queryDefId));
      expect(queue![0]).toBe(queryKey2);
      expect(queue![1]).toBe(queryKey1);

      // Re-activate query 1
      writerStore.activateQuery({ id: queryDefId } as any, queryKey1);
      await sleep(50);

      queue = await mockDelegate.getBuffer(queueKeyFor(queryDefId));
      expect(queue![0]).toBe(queryKey1);
      expect(queue![1]).toBe(queryKey2);
    });
  });

  describe('Load Query', () => {
    it('should load query from delegate', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);
      const user = { id: '1', name: 'Alice' };

      await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify(user));
      await mockDelegate.setNumber(updatedAtKeyFor(queryKey), Date.now());

      const cached = await writerStore.loadQuery({ id: queryDefId } as any, queryKey, {} as any);

      expect(cached).toBeDefined();
      expect(cached!.value).toEqual(user);
      expect(cached!.updatedAt).toBeDefined();
    });

    it('should return undefined for expired queries', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);
      const user = { id: '1', name: 'Alice' };

      // Set old timestamp (more than 24 hours ago)
      const oldTime = Date.now() - 1000 * 60 * 60 * 25; // 25 hours ago

      await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify(user));
      await mockDelegate.setNumber(updatedAtKeyFor(queryKey), oldTime);

      const cached = await writerStore.loadQuery({ id: queryDefId } as any, queryKey, {} as any);

      expect(cached).toBeUndefined();
    });

    it('should return undefined for non-existent queries', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '999' }]);

      const cached = await writerStore.loadQuery({ id: queryDefId } as any, queryKey, {} as any);

      expect(cached).toBeUndefined();
    });

    it('should preload entities when loading query with refIds', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);
      const entityId = 100;

      const user = { id: '1', name: 'Alice' };
      const entity = { id: 'e1', data: 'entity-data' };

      // Save query with refIds
      await mockDelegate.setString(valueKeyFor(queryKey), JSON.stringify(user));
      await mockDelegate.setNumber(updatedAtKeyFor(queryKey), Date.now());
      await mockDelegate.setBuffer(refIdsKeyFor(queryKey), new Uint32Array([entityId]));

      // Save entity
      await mockDelegate.setString(valueKeyFor(entityId), JSON.stringify(entity));

      const entityMap = {
        setPreloadedEntity: (id: number, value: any) => {
          expect(id).toBe(entityId);
          expect(value).toEqual(entity);
        },
      } as any;

      const cached = await writerStore.loadQuery({ id: queryDefId } as any, queryKey, entityMap);

      expect(cached).toBeDefined();
      expect(cached!.refIds).toEqual(new Set([entityId]));
    });
  });

  describe('Integration with QueryClient', () => {
    it('should directly save and load data via stores', async () => {
      const queryDefId = 'GET:/users/[id]';
      const queryKey = hashValue([queryDefId, { id: '1' }]);
      const userData = { id: '1', name: 'Alice' };
      const now = Date.now();

      // Reader saves data (sends to writer)
      readerStore.saveQuery({ id: queryDefId } as any, queryKey, userData, now);

      // Wait for writer to process
      await sleep(200);

      // Check if data was persisted
      const persistedValue = await mockDelegate.getString(valueKeyFor(queryKey));
      const persistedTime = await mockDelegate.getNumber(updatedAtKeyFor(queryKey));

      expect(persistedValue).toBeDefined();
      expect(JSON.parse(persistedValue!)).toEqual(userData);
      expect(persistedTime).toBe(now);

      // Create new reader and load the data
      const newMessageChannel = new MessageChannel();
      const newReaderStore = new AsyncQueryStore({
        isWriter: false,
        delegate: mockDelegate,
        connect: handler => newMessageChannel.connectReader(handler),
      });

      const loaded = await newReaderStore.loadQuery({ id: queryDefId } as any, queryKey, {} as any);
      expect(loaded).toBeDefined();
      expect(loaded!.value).toEqual(userData);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in queue processing gracefully', async () => {
      // Create a delegate that throws errors
      const errorDelegate = new MockAsyncPersistentStore();
      const originalSetString = errorDelegate.setString.bind(errorDelegate);
      let errorCount = 0;

      errorDelegate.setString = async (key: string, value: string) => {
        if (errorCount < 1) {
          errorCount++;
          throw new Error('Storage error');
        }
        return originalSetString(key, value);
      };

      const errorWriterStore = new AsyncQueryStore({
        isWriter: true,
        delegate: errorDelegate,
        connect: handler => messageChannel.connectWriter(handler),
      });

      const queryKey = 12345;

      // This should error but not crash
      errorWriterStore.saveQuery({ id: 'test' } as any, queryKey, { data: 'test' }, Date.now());
      await sleep(100);

      // Second save should succeed
      errorWriterStore.saveQuery({ id: 'test2' } as any, queryKey + 1, { data: 'test2' }, Date.now());
      await sleep(100);

      const saved = await errorDelegate.getString(valueKeyFor(queryKey + 1));
      expect(saved).toBeDefined();
    });
  });
});
