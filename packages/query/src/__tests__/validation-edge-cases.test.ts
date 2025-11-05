import { describe, it, expect, beforeEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { query } from '../query.js';
import { parseValue } from '../proxy.js';
import { watcher } from 'signalium';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Type Validation and Edge Case Tests
 *
 * Tests type system validation, error handling, boundary conditions,
 * and edge cases.
 */

describe('Type Validation and Edge Cases', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Primitive Type Validation', () => {
    it('should validate string types', async () => {
      mockFetch.get('/item', { name: 'Test String' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { name: t.string },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.name).toBe('Test String');
        expect(typeof result.name).toBe('string');
      });
    });

    it('should validate number types', async () => {
      mockFetch.get('/item', { count: 42, price: 19.99 });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { count: t.number, price: t.number },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.count).toBe(42);
        expect(result.price).toBe(19.99);
        expect(typeof result.count).toBe('number');
      });
    });

    it('should validate boolean types', async () => {
      mockFetch.get('/item', { active: true, deleted: false });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { active: t.boolean, deleted: t.boolean },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.active).toBe(true);
        expect(result.deleted).toBe(false);
      });
    });

    it('should handle null values', async () => {
      mockFetch.get('/item', { value: null });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.union(t.string, t.null) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.value).toBeNull();
      });
    });

    it('should handle undefined values', async () => {
      mockFetch.get('/item', { optional: undefined });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { optional: t.union(t.string, t.undefined) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.optional).toBeUndefined();
      });
    });
  });

  describe('Complex Type Validation', () => {
    it('should validate objects with mixed types', async () => {
      mockFetch.get('/item', {
        data: {
          id: 1,
          name: 'Test',
          active: true,
          tags: ['tag1', 'tag2'],
        },
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
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
        const result = await relay;

        expect(result.data.id).toBe(1);
        expect(result.data.name).toBe('Test');
        expect(result.data.active).toBe(true);
        expect(result.data.tags).toEqual(['tag1', 'tag2']);
      });
    });

    it('should validate arrays of primitives', async () => {
      mockFetch.get('/arrays', {
        numbers: [1, 2, 3, 4, 5],
        strings: ['a', 'b', 'c'],
        booleans: [true, false, true],
      });

      await testWithClient(client, async () => {
        const getArrays = query(() => ({
          path: '/arrays',
          response: {
            numbers: t.array(t.number),
            strings: t.array(t.string),
            booleans: t.array(t.boolean),
          },
        }));

        const relay = getArrays();
        const result = await relay;

        expect(result.numbers).toEqual([1, 2, 3, 4, 5]);
        expect(result.strings).toEqual(['a', 'b', 'c']);
        expect(result.booleans).toEqual([true, false, true]);
      });
    });

    it('should validate arrays of objects', async () => {
      mockFetch.get('/items', {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
      });

      await testWithClient(client, async () => {
        const getItems = query(() => ({
          path: '/items',
          response: {
            items: t.array(t.object({ id: t.number, name: t.string })),
          },
        }));

        const relay = getItems();
        const result = await relay;

        expect(result.items).toHaveLength(2);
        expect(result.items[0].name).toBe('Item 1');
        expect(result.items[1].name).toBe('Item 2');
      });
    });

    it('should validate record types', async () => {
      mockFetch.get('/metadata', {
        metadata: {
          key1: 'value1',
          key2: 'value2',
          key3: 'value3',
        },
      });

      await testWithClient(client, async () => {
        const getMetadata = query(() => ({
          path: '/metadata',
          response: {
            metadata: t.record(t.string),
          },
        }));

        const relay = getMetadata();
        const result = await relay;

        expect(result.metadata.key1).toBe('value1');
        expect(result.metadata.key2).toBe('value2');
        expect(result.metadata.key3).toBe('value3');
      });
    });

    it('should validate union types with primitives', async () => {
      mockFetch.get('/values', {
        value1: 'string',
        value2: 42,
        value3: true,
      });

      await testWithClient(client, async () => {
        const UnionType = t.union(t.string, t.number, t.boolean);

        const getValues = query(() => ({
          path: '/values',
          response: {
            value1: UnionType,
            value2: UnionType,
            value3: UnionType,
          },
        }));

        const relay = getValues();
        const result = await relay;

        expect(result.value1).toBe('string');
        expect(result.value2).toBe(42);
        expect(result.value3).toBe(true);
      });
    });
  });

  describe('Const Value Validation', () => {
    it('should validate string constants', async () => {
      mockFetch.get('/item', { type: 'user', status: 'active' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: {
            type: t.const('user'),
            status: t.const('active'),
          },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.type).toBe('user');
        expect(result.status).toBe('active');
      });
    });

    it('should validate boolean constants', async () => {
      mockFetch.get('/config', { isEnabled: true });

      await testWithClient(client, async () => {
        const getConfig = query(() => ({
          path: '/config',
          response: {
            isEnabled: t.const(true),
          },
        }));

        const relay = getConfig();
        const result = await relay;

        expect(result.isEnabled).toBe(true);
      });
    });

    it('should validate number constants', async () => {
      mockFetch.get('/version', { version: 1 });

      await testWithClient(client, async () => {
        const getVersion = query(() => ({
          path: '/version',
          response: {
            version: t.const(1),
          },
        }));

        const relay = getVersion();
        const result = await relay;

        expect(result.version).toBe(1);
      });
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle empty arrays', async () => {
      mockFetch.get('/items', { items: [] });

      await testWithClient(client, async () => {
        const getItems = query(() => ({
          path: '/items',
          response: { items: t.array(t.number) },
        }));

        const relay = getItems();
        const result = await relay;

        expect(result.items).toEqual([]);
        expect(result.items).toHaveLength(0);
      });
    });

    it('should handle empty objects', async () => {
      mockFetch.get('/metadata', { metadata: {} });

      await testWithClient(client, async () => {
        const getMetadata = query(() => ({
          path: '/metadata',
          response: { metadata: t.record(t.string) },
        }));

        const relay = getMetadata();
        const result = await relay;

        expect(result.metadata).toEqual({});
        expect(Object.keys(result.metadata)).toHaveLength(0);
      });
    });

    it('should handle empty strings', async () => {
      mockFetch.get('/item', { value: '' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.string },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.value).toBe('');
      });
    });

    it('should handle zero and negative numbers', async () => {
      mockFetch.get('/numbers', { zero: 0, negative: -42, float: -3.14 });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: { zero: t.number, negative: t.number, float: t.number },
        }));

        const relay = getNumbers();
        const result = await relay;

        expect(result.zero).toBe(0);
        expect(result.negative).toBe(-42);
        expect(result.float).toBe(-3.14);
      });
    });

    it('should handle large arrays', async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      mockFetch.get('/numbers', { numbers: largeArray });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: { numbers: t.array(t.number) },
        }));

        const relay = getNumbers();
        const result = await relay;

        expect(result.numbers).toHaveLength(1000);
        expect(result.numbers[0]).toBe(0);
        expect(result.numbers[999]).toBe(999);
      });
    });

    it('should handle deeply nested objects', async () => {
      mockFetch.get('/deep', {
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
      });

      await testWithClient(client, async () => {
        const getDeep = query(() => ({
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
        const result = await relay;

        expect(result.level1.level2.level3.level4.level5.value).toBe('deep');
      });
    });
  });

  describe('Optional and Nullable Types', () => {
    it('should accept undefined for optional types', async () => {
      mockFetch.get('/item', { required: 'test', optional: undefined });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: {
            required: t.string,
            optional: t.union(t.string, t.undefined),
          },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.required).toBe('test');
        expect(result.optional).toBeUndefined();
      });
    });

    it('should accept null for nullable types', async () => {
      mockFetch.get('/item', { required: 'test', nullable: null });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: {
            required: t.string,
            nullable: t.union(t.string, t.null),
          },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.required).toBe('test');
        expect(result.nullable).toBeNull();
      });
    });

    it('should handle nullish types (null or undefined)', async () => {
      mockFetch.get('/item', {
        nullValue: null,
        undefinedValue: undefined,
        stringValue: 'present',
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: {
            nullValue: t.union(t.string, t.null, t.undefined),
            undefinedValue: t.union(t.string, t.null, t.undefined),
            stringValue: t.union(t.string, t.null, t.undefined),
          },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.nullValue).toBeNull();
        expect(result.undefinedValue).toBeUndefined();
        expect(result.stringValue).toBe('present');
      });
    });
  });

  describe('Validation Error Messages', () => {
    it('should show descriptive error messages with typeToString formatting', () => {
      // Test nested object path
      expect(() => {
        parseValue('not a number', t.number, 'GET:/user.profile.age');
      }).toThrow('Validation error at GET:/user.profile.age: expected number, got string');

      // Test array index path
      expect(() => {
        parseValue('wrong', t.number, 'GET:/items[2].id');
      }).toThrow('Validation error at GET:/items[2].id: expected number, got string');

      // Test union types
      expect(() => {
        parseValue({}, t.union(t.string, t.number), 'GET:/status.value');
      }).toThrow(/Validation error at GET:\/status\.value: expected .*(string.*number|number.*string).*, got object/);

      // Test constant values
      expect(() => {
        parseValue('admin', t.const('user'), 'GET:/config.type');
      }).toThrow('Validation error at GET:/config.type: expected "user", got string');

      // Test null values
      expect(() => {
        parseValue(null, t.string, 'GET:/data.required');
      }).toThrow('Validation error at GET:/data.required: expected string, got null');

      // Test record key path
      expect(() => {
        parseValue(123, t.string, 'GET:/metadata["key2"]');
      }).toThrow('Validation error at GET:/metadata["key2"]: expected string, got number');
    });
  });

  describe('Error Handling', () => {
    it('should handle fetch errors gracefully', async () => {
      mockFetch.get('/item', null, {
        error: new Error('Network error'),
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow('Network error');
        expect(relay.isRejected).toBe(true);
      });
    });

    it('should handle JSON parsing errors', async () => {
      mockFetch.get('/item', null, {
        jsonError: new Error('Invalid JSON'),
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { data: t.string },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow('Invalid JSON');
      });
    });

    it('should require QueryClient context', () => {
      const getItem = query(() => ({
        path: '/item',
        response: { data: t.string },
      }));

      // Call without context should throw
      expect(() => getItem()).toThrow('QueryClient not found');
    });
  });

  describe('Path Interpolation Edge Cases', () => {
    it('should handle paths with no parameters', async () => {
      mockFetch.get('/static/path', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/static/path',
          response: { data: t.string },
        }));

        const relay = getItem();
        await relay;

        expect(mockFetch.calls[0].url).toBe('/static/path');
      });
    });

    it('should handle multiple path parameters', async () => {
      mockFetch.get('/org/[orgId]/team/[teamId]/user/[userId]', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/org/[orgId]/team/[teamId]/user/[userId]',
          response: { data: t.string },
        }));

        const relay = getItem({ orgId: '1', teamId: '2', userId: '3' });
        await relay;

        expect(mockFetch.calls[0].url).toContain('/org/1/team/2/user/3');
      });
    });
  });

  describe('Memory and Performance', () => {
    it('should handle many concurrent queries', async () => {
      // Set up 50 individual mock responses
      for (let i = 0; i < 50; i++) {
        mockFetch.get('/items/[id]', { url: `/items/${i}` });
      }

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/items/[id]',
          response: { url: t.string },
        }));

        const relays = [];

        // Create 50 concurrent queries
        for (let i = 0; i < 50; i++) {
          const relay = getItem({ id: String(i) });
          relays.push(relay);
        }

        // Wait for all to complete
        await Promise.all(relays);

        // Should have handled all queries
        expect(mockFetch.calls).toHaveLength(50);
      });
    });

    it('should cleanup watchers properly', async () => {
      mockFetch.get('/counter', { count: 1 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
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
        await relay;

        expect(relay.isReady).toBe(true);
      });
    });
  });

  describe('Special Number Values', () => {
    it('should handle special number values if API returns them', async () => {
      mockFetch.get('/numbers', {
        zero: 0,
        maxSafe: Number.MAX_SAFE_INTEGER,
        minSafe: Number.MIN_SAFE_INTEGER,
      });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: {
            zero: t.number,
            maxSafe: t.number,
            minSafe: t.number,
          },
        }));

        const relay = getNumbers();
        const result = await relay;

        expect(result.zero).toBe(0);
        expect(result.maxSafe).toBe(Number.MAX_SAFE_INTEGER);
        expect(result.minSafe).toBe(Number.MIN_SAFE_INTEGER);
      });
    });
  });

  describe('Query Definition Caching', () => {
    it('should cache query definition across calls', async () => {
      mockFetch.get('/counter', { count: 1 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
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

        await relay1;

        // Should only fetch once
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should create definition only once per query function', async () => {
      let definitionBuildCount = 0;

      mockFetch.get('/item', { data: 'test' });

      await testWithClient(client, async () => {
        const getItem = query(() => {
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

        await Promise.all([relay1, relay2, relay3]);

        // Definition should only be built once
        expect(definitionBuildCount).toBe(1);
      });
    });
  });

  describe('Method Support', () => {
    it('should include method in query ID', async () => {
      mockFetch.get('/items', { success: true });
      mockFetch.post('/items', { success: true });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/items',
          method: 'GET',
          response: { success: t.boolean },
        }));

        const postItem = query(() => ({
          path: '/items',
          method: 'POST',
          response: { success: t.boolean },
        }));

        const relay1 = getItem();
        const relay2 = postItem();

        // Different methods should create different relays
        expect(relay1).not.toBe(relay2);

        await Promise.all([relay1, relay2]);
      });
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle race conditions safely', async () => {
      // Set up single mock response with delay - testing query deduplication
      mockFetch.get('/counter', { count: 1 }, { delay: 25 });

      await testWithClient(client, async () => {
        const getCounter = query(() => ({
          path: '/counter',
          response: { count: t.number },
        }));

        // Start many concurrent requests with random delays
        const promises = [];

        for (let i = 0; i < 20; i++) {
          const relay = getCounter();
          promises.push(relay);
        }

        // All should resolve to the same value (deduplication)
        const results = await Promise.all(promises);

        // Should only fetch once despite concurrent requests
        expect(mockFetch.calls).toHaveLength(1);

        // All results should be identical
        results.forEach(result => {
          expect(result.count).toBe(1);
        });
      });
    });
  });
});
