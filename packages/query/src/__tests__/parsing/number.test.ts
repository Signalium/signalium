import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.number Tests
 *
 * Tests for number type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.number', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse valid numbers', () => {
        expect(parseValue(42, t.number, 'test')).toBe(42);
        expect(parseValue(0, t.number, 'test')).toBe(0);
        expect(parseValue(-42, t.number, 'test')).toBe(-42);
        expect(parseValue(3.14, t.number, 'test')).toBe(3.14);
      });

      it('should parse edge case numbers', () => {
        expect(parseValue(Number.MAX_SAFE_INTEGER, t.number, 'test')).toBe(Number.MAX_SAFE_INTEGER);
        expect(parseValue(Number.MIN_SAFE_INTEGER, t.number, 'test')).toBe(Number.MIN_SAFE_INTEGER);
        expect(parseValue(0.1 + 0.2, t.number, 'test')).toBeCloseTo(0.3);
      });

      it('should throw for non-number values', () => {
        expect(() => parseValue('42', t.number, 'test')).toThrow('expected number, got string');
        expect(() => parseValue(true, t.number, 'test')).toThrow('expected number, got boolean');
        expect(() => parseValue(null, t.number, 'test')).toThrow('expected number, got null');
        expect(() => parseValue(undefined, t.number, 'test')).toThrow('expected number, got undefined');
        expect(() => parseValue({}, t.number, 'test')).toThrow('expected number, got object');
        expect(() => parseValue([], t.number, 'test')).toThrow('expected number, got array');
      });
    });

    describe('within object', () => {
      it('should parse number fields in objects', () => {
        const objType = t.object({ count: t.number, price: t.number });
        const result = parseValue({ count: 10, price: 19.99 }, objType, 'test') as { count: number; price: number };

        expect(result.count).toBe(10);
        expect(result.price).toBe(19.99);
      });

      it('should throw for invalid number field in object', () => {
        const objType = t.object({ count: t.number });

        expect(() => parseValue({ count: 'ten' }, objType, 'test')).toThrow('expected number, got string');
      });
    });

    describe('within array', () => {
      it('should parse array of numbers', () => {
        const result = parseValue([1, 2, 3], t.array(t.number), 'test');
        expect(result).toEqual([1, 2, 3]);
      });

      it('should parse empty number array', () => {
        const result = parseValue([], t.array(t.number), 'test');
        expect(result).toEqual([]);
      });

      it('should filter invalid items in array with warning callback', () => {
        const result = parseValue([1, 'invalid', 3], t.array(t.number), 'test', false, () => {});
        expect(result).toEqual([1, 3]);
      });
    });

    describe('within record', () => {
      it('should parse record of numbers', () => {
        const result = parseValue({ count: 42, price: 19.99 }, t.record(t.number), 'test');
        expect(result).toEqual({ count: 42, price: 19.99 });
      });

      it('should throw for invalid value in record', () => {
        expect(() => parseValue({ count: 42, price: 'invalid' }, t.record(t.number), 'test')).toThrow(
          'expected number, got string',
        );
      });
    });

    describe('within union', () => {
      it('should parse number in union', () => {
        const unionType = t.union(t.string, t.number);
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });

      it('should throw for values not in union', () => {
        const unionType = t.union(t.string, t.number);
        expect(() => parseValue(true, unionType, 'test')).toThrow();
      });
    });

    describe('edge cases', () => {
      it('should handle zero and negative numbers', () => {
        expect(parseValue(0, t.number, 'test')).toBe(0);
        expect(parseValue(-0, t.number, 'test')).toBe(-0);
        expect(parseValue(-42, t.number, 'test')).toBe(-42);
        expect(parseValue(-3.14, t.number, 'test')).toBe(-3.14);
      });

      it('should handle floating point numbers', () => {
        expect(parseValue(3.14159, t.number, 'test')).toBe(3.14159);
        expect(parseValue(1e10, t.number, 'test')).toBe(1e10);
        expect(parseValue(1e-10, t.number, 'test')).toBe(1e-10);
      });

      it('should show correct error path', () => {
        expect(() => parseValue('42', t.number, 'GET:/items[2].id')).toThrow(
          'Validation error at GET:/items[2].id: expected number, got string',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse number in query response', async () => {
        const { client, mockFetch } = getContext();
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

      it('should handle max/min safe integer values', async () => {
        const { client, mockFetch } = getContext();
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

      it('should handle zero and negative numbers', async () => {
        const { client, mockFetch } = getContext();
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
    });

    describe('within object', () => {
      it('should parse number in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', {
          item: { stats: { views: 100, likes: 42 } },
        });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              item: t.object({
                stats: t.object({
                  views: t.number,
                  likes: t.number,
                }),
              }),
            },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.item.stats.views).toBe(100);
          expect(result.item.stats.likes).toBe(42);
        });
      });
    });

    describe('within array', () => {
      it('should parse array of numbers', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/numbers', { values: [1, 2, 3, 4, 5] });

        await testWithClient(client, async () => {
          const getNumbers = query(() => ({
            path: '/numbers',
            response: { values: t.array(t.number) },
          }));

          const relay = getNumbers();
          const result = await relay;

          expect(result.values).toEqual([1, 2, 3, 4, 5]);
        });
      });

      it('should handle large arrays', async () => {
        const { client, mockFetch } = getContext();
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
    });

    describe('within record', () => {
      it('should parse record of numbers', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/metrics', {
          counts: { users: 1000, posts: 5000 },
        });

        await testWithClient(client, async () => {
          const getMetrics = query(() => ({
            path: '/metrics',
            response: { counts: t.record(t.number) },
          }));

          const relay = getMetrics();
          const result = await relay;

          expect(result.counts.users).toBe(1000);
          expect(result.counts.posts).toBe(5000);
        });
      });
    });

    describe('within union', () => {
      it('should parse number in union response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/value', { value: 42 });

        await testWithClient(client, async () => {
          const getValue = query(() => ({
            path: '/value',
            response: { value: t.union(t.string, t.number) },
          }));

          const relay = getValue();
          const result = await relay;

          expect(result.value).toBe(42);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse number field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          age: t.number,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, age: 30 },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).age).toBe(30);
      });
    });

    describe('within object', () => {
      it('should parse number in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Product = entity(() => ({
          __typename: t.typename('Product'),
          id: t.id,
          pricing: t.object({
            amount: t.number,
            discount: t.number,
          }),
        }));

        const QueryResult = t.object({ product: Product });

        const result = {
          product: {
            __typename: 'Product',
            id: 1,
            pricing: { amount: 99.99, discount: 10 },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Product', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).pricing.amount).toBe(99.99);
        expect((doc as any).pricing.discount).toBe(10);
      });
    });

    describe('within array', () => {
      it('should parse number array in entity', async () => {
        const { client, kv } = getContext();

        const Stats = entity(() => ({
          __typename: t.typename('Stats'),
          id: t.id,
          scores: t.array(t.number),
        }));

        const QueryResult = t.object({ stats: Stats });

        const result = {
          stats: {
            __typename: 'Stats',
            id: 1,
            scores: [100, 95, 88],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Stats', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).scores).toEqual([100, 95, 88]);
      });
    });

    describe('within record', () => {
      it('should parse number record in entity', async () => {
        const { client, kv } = getContext();

        const Metrics = entity(() => ({
          __typename: t.typename('Metrics'),
          id: t.id,
          counts: t.record(t.number),
        }));

        const QueryResult = t.object({ metrics: Metrics });

        const result = {
          metrics: {
            __typename: 'Metrics',
            id: 1,
            counts: { views: 1000, clicks: 50 },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Metrics', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).counts).toEqual({ views: 1000, clicks: 50 });
      });
    });

    describe('within union', () => {
      it('should parse number in union field of entity', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          value: t.union(t.string, t.number),
        }));

        const QueryResult = t.object({ item: Item });

        const result = {
          item: {
            __typename: 'Item',
            id: 1,
            value: 42,
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Item', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toBe(42);
      });
    });
  });
});
