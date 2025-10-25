import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NormalizedDocumentStore, MemoryPersistentStore } from '../documentStore.js';
import { QueryClient, t, query, QueryClientContext } from '../client.js';
import { watcher, withContexts } from 'signalium';

/**
 * Type Validation and Edge Case Tests
 *
 * Tests type system validation, error handling, boundary conditions,
 * and edge cases.
 */

function createTestWatcher<T>(fn: () => T): { unsub: () => void } {
  const w = watcher(fn);
  const unsub = w.addListener(() => {});
  return { unsub };
}

describe('Type Validation and Edge Cases', () => {
  let kv: MemoryPersistentStore;
  let store: NormalizedDocumentStore;
  let client: QueryClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new NormalizedDocumentStore(kv);
    mockFetch = vi.fn();
    client = new QueryClient(kv, store, { fetch: mockFetch as any });
  });

  describe('Primitive Type Validation', () => {
    it('should validate string types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ name: 'Test String' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { name: t.string },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.name).toBe('Test String');
        expect(typeof result.name).toBe('string');

        w.unsub();
      });
    });

    it('should validate number types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ count: 42, price: 19.99 }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { count: t.number, price: t.number },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.count).toBe(42);
        expect(result.price).toBe(19.99);
        expect(typeof result.count).toBe('number');

        w.unsub();
      });
    });

    it('should validate boolean types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ active: true, deleted: false }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { active: t.boolean, deleted: t.boolean },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.active).toBe(true);
        expect(result.deleted).toBe(false);

        w.unsub();
      });
    });

    it('should handle null values', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ value: null }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { value: t.union(t.string, t.null) },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.value).toBeNull();

        w.unsub();
      });
    });

    it('should handle undefined values', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ optional: undefined }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { optional: t.union(t.string, t.undefined) },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.optional).toBeUndefined();

        w.unsub();
      });
    });
  });

  describe('Complex Type Validation', () => {
    it('should validate objects with mixed types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          data: {
            id: 1,
            name: 'Test',
            active: true,
            tags: ['tag1', 'tag2'],
          },
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: {
            data: t.object({
              id: t.number,
              name: t.string,
              active: t.boolean,
              tags: t.array(t.string),
            }),
          },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.data.id).toBe(1);
        expect(result.data.name).toBe('Test');
        expect(result.data.active).toBe(true);
        expect(result.data.tags).toEqual(['tag1', 'tag2']);

        w.unsub();
      });
    });

    it('should validate arrays of primitives', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          numbers: [1, 2, 3, 4, 5],
          strings: ['a', 'b', 'c'],
          booleans: [true, false, true],
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getArrays = query(t => ({
          path: '/arrays',
          response: {
            numbers: t.array(t.number),
            strings: t.array(t.string),
            booleans: t.array(t.boolean),
          },
        }));

        const relay = getArrays();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.numbers).toEqual([1, 2, 3, 4, 5]);
        expect(result.strings).toEqual(['a', 'b', 'c']);
        expect(result.booleans).toEqual([true, false, true]);

        w.unsub();
      });
    });

    it('should validate arrays of objects', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
          ],
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItems = query(t => ({
          path: '/items',
          response: {
            items: t.array(t.object({ id: t.number, name: t.string })),
          },
        }));

        const relay = getItems();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.items).toHaveLength(2);
        expect(result.items[0].name).toBe('Item 1');
        expect(result.items[1].name).toBe('Item 2');

        w.unsub();
      });
    });

    it('should validate record types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          metadata: {
            key1: 'value1',
            key2: 'value2',
            key3: 'value3',
          },
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getMetadata = query(t => ({
          path: '/metadata',
          response: {
            metadata: t.record(t.string),
          },
        }));

        const relay = getMetadata();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.metadata.key1).toBe('value1');
        expect(result.metadata.key2).toBe('value2');
        expect(result.metadata.key3).toBe('value3');

        w.unsub();
      });
    });

    it('should validate union types with primitives', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          value1: 'string',
          value2: 42,
          value3: true,
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const UnionType = t.union(t.string, t.number, t.boolean);

        const getValues = query(t => ({
          path: '/values',
          response: {
            value1: UnionType,
            value2: UnionType,
            value3: UnionType,
          },
        }));

        const relay = getValues();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.value1).toBe('string');
        expect(result.value2).toBe(42);
        expect(result.value3).toBe(true);

        w.unsub();
      });
    });
  });

  describe('Const Value Validation', () => {
    it('should validate string constants', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ type: 'user', status: 'active' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: {
            type: t.const('user'),
            status: t.const('active'),
          },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.type).toBe('user');
        expect(result.status).toBe('active');

        w.unsub();
      });
    });

    it('should validate boolean constants', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ isEnabled: true }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getConfig = query(t => ({
          path: '/config',
          response: {
            isEnabled: t.const(true),
          },
        }));

        const relay = getConfig();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.isEnabled).toBe(true);

        w.unsub();
      });
    });

    it('should validate number constants', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ version: 1 }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getVersion = query(t => ({
          path: '/version',
          response: {
            version: t.const(1),
          },
        }));

        const relay = getVersion();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.version).toBe(1);

        w.unsub();
      });
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle empty arrays', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ items: [] }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItems = query(t => ({
          path: '/items',
          response: { items: t.array(t.number) },
        }));

        const relay = getItems();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.items).toEqual([]);
        expect(result.items).toHaveLength(0);

        w.unsub();
      });
    });

    it('should handle empty objects', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ metadata: {} }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getMetadata = query(t => ({
          path: '/metadata',
          response: { metadata: t.record(t.string) },
        }));

        const relay = getMetadata();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.metadata).toEqual({});
        expect(Object.keys(result.metadata)).toHaveLength(0);

        w.unsub();
      });
    });

    it('should handle empty strings', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ value: '' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { value: t.string },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.value).toBe('');

        w.unsub();
      });
    });

    it('should handle zero and negative numbers', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ zero: 0, negative: -42, float: -3.14 }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getNumbers = query(t => ({
          path: '/numbers',
          response: { zero: t.number, negative: t.number, float: t.number },
        }));

        const relay = getNumbers();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.zero).toBe(0);
        expect(result.negative).toBe(-42);
        expect(result.float).toBe(-3.14);

        w.unsub();
      });
    });

    it('should handle large arrays', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      mockFetch.mockResolvedValue({
        json: async () => ({ numbers: largeArray }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getNumbers = query(t => ({
          path: '/numbers',
          response: { numbers: t.array(t.number) },
        }));

        const relay = getNumbers();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.numbers).toHaveLength(1000);
        expect(result.numbers[0]).toBe(0);
        expect(result.numbers[999]).toBe(999);

        w.unsub();
      });
    });

    it('should handle deeply nested objects', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: 'deep',
                  },
                },
              },
            },
          },
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getDeep = query(t => ({
          path: '/deep',
          response: {
            level1: t.object({
              level2: t.object({
                level3: t.object({
                  level4: t.object({
                    level5: t.object({
                      value: t.string,
                    }),
                  }),
                }),
              }),
            }),
          },
        }));

        const relay = getDeep();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.level1.level2.level3.level4.level5.value).toBe('deep');

        w.unsub();
      });
    });
  });

  describe('Optional and Nullable Types', () => {
    it('should accept undefined for optional types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ required: 'test', optional: undefined }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: {
            required: t.string,
            optional: t.union(t.string, t.undefined),
          },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.required).toBe('test');
        expect(result.optional).toBeUndefined();

        w.unsub();
      });
    });

    it('should accept null for nullable types', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ required: 'test', nullable: null }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: {
            required: t.string,
            nullable: t.union(t.string, t.null),
          },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.required).toBe('test');
        expect(result.nullable).toBeNull();

        w.unsub();
      });
    });

    it('should handle nullish types (null or undefined)', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          nullValue: null,
          undefinedValue: undefined,
          stringValue: 'present',
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: {
            nullValue: t.union(t.string, t.null, t.undefined),
            undefinedValue: t.union(t.string, t.null, t.undefined),
            stringValue: t.union(t.string, t.null, t.undefined),
          },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.nullValue).toBeNull();
        expect(result.undefinedValue).toBeUndefined();
        expect(result.stringValue).toBe('present');

        w.unsub();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);

        await expect(relay).rejects.toThrow('Network error');
        expect(relay.isRejected).toBe(true);

        w.unsub();
      });
    });

    it('should handle JSON parsing errors', async () => {
      mockFetch.mockResolvedValue({
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);

        await expect(relay).rejects.toThrow('Invalid JSON');

        w.unsub();
      });
    });

    it('should require QueryClient context', () => {
      const getItem = query(t => ({
        path: '/item',
        response: { data: t.string },
      }));

      // Call without context should throw
      expect(() => getItem()).toThrow('QueryClient not found');
    });
  });

  describe('Path Interpolation Edge Cases', () => {
    it('should handle paths with no parameters', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ data: 'test' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/static/path',
          response: { data: t.string },
        }));

        const relay = getItem();
        const w = createTestWatcher(() => relay.value);
        await relay;

        expect(mockFetch).toHaveBeenCalledWith('/static/path', {
          method: 'GET',
        });

        w.unsub();
      });
    });

    it('should handle multiple path parameters', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ data: 'test' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/org/[orgId]/team/[teamId]/user/[userId]',
          response: { data: t.string },
        }));

        const relay = getItem({ orgId: '1', teamId: '2', userId: '3' });
        const w = createTestWatcher(() => relay.value);
        await relay;

        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/org/1/team/2/user/3'), { method: 'GET' });

        w.unsub();
      });
    });
  });

  describe('Memory and Performance', () => {
    it('should handle many concurrent queries', async () => {
      mockFetch.mockImplementation(async (url: string) => ({
        json: async () => ({ url }),
      }));

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/items/[id]',
          response: { url: t.string },
        }));

        const watchers = [];
        const relays = [];

        // Create 50 concurrent queries
        for (let i = 0; i < 50; i++) {
          const relay = getItem({ id: String(i) });
          relays.push(relay);
          const w = createTestWatcher(() => relay.value);
          watchers.push(w);
        }

        // Wait for all to complete
        await Promise.all(relays);

        // Clean up
        watchers.forEach(w => w.unsub());

        // Should have handled all queries
        expect(mockFetch).toHaveBeenCalledTimes(50);
      });
    });

    it('should cleanup watchers properly', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ count: 1 }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getCounter = query(t => ({
          path: '/counter',
          response: { count: t.number },
        }));

        const relay = getCounter();

        // Create and immediately cleanup multiple watchers
        for (let i = 0; i < 10; i++) {
          const w = watcher(() => relay.value);
          const unsub = w.addListener(() => {});
          unsub();
        }

        // Relay should still work
        const w = createTestWatcher(() => relay.value);
        await relay;

        expect(relay.isReady).toBe(true);

        w.unsub();
      });
    });
  });

  describe('Special Number Values', () => {
    it('should handle special number values if API returns them', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          zero: 0,
          maxSafe: Number.MAX_SAFE_INTEGER,
          minSafe: Number.MIN_SAFE_INTEGER,
        }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getNumbers = query(t => ({
          path: '/numbers',
          response: {
            zero: t.number,
            maxSafe: t.number,
            minSafe: t.number,
          },
        }));

        const relay = getNumbers();
        const w = createTestWatcher(() => relay.value);
        const result = await relay;

        expect(result.zero).toBe(0);
        expect(result.maxSafe).toBe(Number.MAX_SAFE_INTEGER);
        expect(result.minSafe).toBe(Number.MIN_SAFE_INTEGER);

        w.unsub();
      });
    });
  });

  describe('Query Definition Caching', () => {
    it('should cache query definition across calls', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ count: 1 }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getCounter = query(t => ({
          path: '/counter',
          response: { count: t.number },
        }));

        // Call multiple times
        const relay1 = getCounter();
        const relay2 = getCounter();
        const relay3 = getCounter();

        // Should all return the same relay (deduplication)
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        const w = createTestWatcher(() => relay1.value);
        await relay1;

        // Should only fetch once
        expect(mockFetch).toHaveBeenCalledTimes(1);

        w.unsub();
      });
    });

    it('should create definition only once per query function', async () => {
      let definitionBuildCount = 0;

      mockFetch.mockResolvedValue({
        json: async () => ({ data: 'test' }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => {
          definitionBuildCount++;
          return {
            path: '/item',
            response: { data: t.string },
          };
        });

        // Call multiple times
        const relay1 = getItem();
        const relay2 = getItem();
        const relay3 = getItem();

        const w = createTestWatcher(() => relay1.value);

        await Promise.all([relay1, relay2, relay3]);

        // Definition should only be built once
        expect(definitionBuildCount).toBe(1);

        w.unsub();
      });
    });
  });

  describe('Method Support', () => {
    it('should include method in query ID', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ success: true }),
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getItem = query(t => ({
          path: '/items',
          method: 'GET',
          response: { success: t.boolean },
        }));

        const postItem = query(t => ({
          path: '/items',
          method: 'POST',
          response: { success: t.boolean },
        }));

        const relay1 = getItem();
        const relay2 = postItem();

        // Different methods should create different relays
        expect(relay1).not.toBe(relay2);

        const w1 = createTestWatcher(() => relay1.value);
        const w2 = createTestWatcher(() => relay2.value);

        await Promise.all([relay1, relay2]);

        w1.unsub();
        w2.unsub();
      });
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle race conditions safely', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        const delay = Math.random() * 50;
        await new Promise(resolve => setTimeout(resolve, delay));
        return { json: async () => ({ count: callCount }) };
      });

      await withContexts([[QueryClientContext, client]], async () => {
        const getCounter = query(t => ({
          path: '/counter',
          response: { count: t.number },
        }));

        // Start many concurrent requests with random delays
        const promises = [];
        const watchers = [];

        for (let i = 0; i < 20; i++) {
          const relay = getCounter();
          const w = createTestWatcher(() => relay.value);
          watchers.push(w);
          promises.push(relay);
        }

        // All should resolve to the same value (deduplication)
        const results = await Promise.all(promises);

        // Should only fetch once despite concurrent requests
        expect(callCount).toBe(1);

        // All results should be identical
        results.forEach(result => {
          expect(result.count).toBe(1);
        });

        watchers.forEach(w => w.unsub());
      });
    });
  });
});
