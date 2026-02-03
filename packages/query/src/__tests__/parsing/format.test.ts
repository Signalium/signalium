import { describe, it, expect } from 'vitest';
import { t, entity, registerFormat } from '../../typeDefs.js';
import { Mask } from '../../types.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

// Extend the format registry for testing custom formats
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SignaliumQuery {
    interface FormatRegistry {
      price: number;
      percentage: number;
      slug: string;
      coordinates: { lat: number; lng: number };
    }
  }
}

/**
 * t.format Tests
 *
 * Tests for formatted type parsing (date, date-time, custom) across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.format', () => {
  describe('date-time format', () => {
    describe('Direct parseValue', () => {
      describe('basic parsing', () => {
        it('should parse ISO date-time string to Date', () => {
          const result = parseValue('2024-01-15T10:30:00Z', t.format('date-time'), 'test');
          expect(result).toBeInstanceOf(Date);
          expect((result as Date).getFullYear()).toBe(2024);
          expect((result as Date).getUTCMonth()).toBe(0); // January
          expect((result as Date).getUTCDate()).toBe(15);
        });

        it('should parse various ISO formats', () => {
          const result1 = parseValue('2024-06-20T14:45:30.123Z', t.format('date-time'), 'test');
          expect(result1).toBeInstanceOf(Date);

          const result2 = parseValue('2024-01-01T00:00:00Z', t.format('date-time'), 'test');
          expect(result2).toBeInstanceOf(Date);
        });

        it('should throw for invalid date-time strings', () => {
          expect(() => parseValue('not-a-date', t.format('date-time'), 'test')).toThrow();
          expect(() => parseValue('2024-13-45', t.format('date-time'), 'test')).toThrow();
        });

        it('should throw for non-string values', () => {
          expect(() => parseValue(42, t.format('date-time'), 'test')).toThrow();
          expect(() => parseValue(null, t.format('date-time'), 'test')).toThrow();
        });
      });

      describe('within object', () => {
        it('should parse date-time in object', () => {
          const objType = t.object({
            createdAt: t.format('date-time'),
            updatedAt: t.format('date-time'),
          });

          const result = parseValue(
            { createdAt: '2024-01-15T10:30:00Z', updatedAt: '2024-06-20T14:45:30Z' },
            objType,
            'test',
          ) as any;

          expect(result.createdAt).toBeInstanceOf(Date);
          expect(result.updatedAt).toBeInstanceOf(Date);
        });
      });

      describe('within array', () => {
        it('should parse array of date-times', () => {
          const result = parseValue(
            ['2024-01-15T10:30:00Z', '2024-06-20T14:45:30Z'],
            t.array(t.format('date-time')),
            'test',
          ) as Date[];

          expect(result).toHaveLength(2);
          expect(result[0]).toBeInstanceOf(Date);
          expect(result[1]).toBeInstanceOf(Date);
        });
      });

      describe('within record', () => {
        it('should parse record of date-times', () => {
          const result = parseValue(
            { created: '2024-01-15T10:30:00Z', updated: '2024-06-20T14:45:30Z' },
            t.record(t.format('date-time')),
            'test',
          ) as Record<string, Date>;

          expect(result.created).toBeInstanceOf(Date);
          expect(result.updated).toBeInstanceOf(Date);
        });
      });

      describe('with nullable', () => {
        it('should parse date-time with nullable modifier', () => {
          const nullableType = t.nullable(t.format('date-time'));

          const result = parseValue('2024-01-15T10:30:00Z', nullableType, 'test');
          expect(result).toBeInstanceOf(Date);
        });
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should parse date-time in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { createdAt: '2024-01-15T10:30:00Z' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { createdAt: t.format('date-time') },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.createdAt).toBeInstanceOf(Date);
        });
      });

      it('should parse record of date-times in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/timestamps', {
          events: { login: '2024-01-15T10:30:00Z', logout: '2024-01-15T18:45:30Z' },
        });

        await testWithClient(client, async () => {
          const getTimestamps = query(() => ({
            path: '/timestamps',
            response: { events: t.record(t.format('date-time')) },
          }));

          const relay = getTimestamps();
          const result = await relay;

          expect(result.events.login).toBeInstanceOf(Date);
          expect(result.events.logout).toBeInstanceOf(Date);
        });
      });
    });

    describe('Entity integration', () => {
      const getContext = setupParsingTests();

      it('should parse date-time field in entity', async () => {
        const { client, kv } = getContext();

        const Event = entity(() => ({
          __typename: t.typename('Event'),
          id: t.id,
          timestamp: t.format('date-time'),
        }));

        const QueryResult = t.object({ event: Event });

        const result = {
          event: { __typename: 'Event', id: 1, timestamp: '2024-01-15T10:30:00Z' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Event', 1, Event.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        // Note: Date objects are serialized to ISO strings in JSON
      });
    });
  });

  describe('date format', () => {
    describe('Direct parseValue', () => {
      describe('basic parsing', () => {
        it('should parse ISO date string to Date', () => {
          const result = parseValue('2024-01-15', t.format('date'), 'test');
          expect(result).toBeInstanceOf(Date);
          expect((result as Date).getUTCFullYear()).toBe(2024);
          expect((result as Date).getUTCMonth()).toBe(0); // January
          expect((result as Date).getUTCDate()).toBe(15);
        });

        it('should throw for invalid date strings', () => {
          expect(() => parseValue('not-a-date', t.format('date'), 'test')).toThrow();
          expect(() => parseValue('2024/01/15', t.format('date'), 'test')).toThrow();
          expect(() => parseValue('01-15-2024', t.format('date'), 'test')).toThrow();
        });

        it('should throw for non-string values', () => {
          expect(() => parseValue(42, t.format('date'), 'test')).toThrow();
          expect(() => parseValue(null, t.format('date'), 'test')).toThrow();
        });
      });

      describe('within object', () => {
        it('should parse date in object', () => {
          const objType = t.object({
            birthDate: t.format('date'),
            joinDate: t.format('date'),
          });

          const result = parseValue({ birthDate: '1990-05-20', joinDate: '2024-01-15' }, objType, 'test') as any;

          expect(result.birthDate).toBeInstanceOf(Date);
          expect(result.joinDate).toBeInstanceOf(Date);
        });
      });

      describe('within array', () => {
        it('should parse array of dates', () => {
          const result = parseValue(
            ['2024-01-01', '2024-02-01', '2024-03-01'],
            t.array(t.format('date')),
            'test',
          ) as Date[];

          expect(result).toHaveLength(3);
          result.forEach(d => expect(d).toBeInstanceOf(Date));
        });
      });

      describe('within record', () => {
        it('should parse record of dates', () => {
          const result = parseValue(
            { start: '2024-01-01', end: '2024-12-31' },
            t.record(t.format('date')),
            'test',
          ) as Record<string, Date>;

          expect(result.start).toBeInstanceOf(Date);
          expect(result.end).toBeInstanceOf(Date);
        });
      });

      describe('with nullable', () => {
        it('should parse date with nullable modifier', () => {
          const nullableType = t.nullable(t.format('date'));

          const result = parseValue('2024-01-15', nullableType, 'test');
          expect(result).toBeInstanceOf(Date);
        });
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should parse date in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', { birthDate: '1990-05-20' });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: { birthDate: t.format('date') },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.birthDate).toBeInstanceOf(Date);
        });
      });
    });

    describe('Entity integration', () => {
      const getContext = setupParsingTests();

      it('should parse date field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          birthDate: t.format('date'),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, birthDate: '1990-05-20' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });
  });

  describe('optional/nullable formats', () => {
    describe('Direct parseValue', () => {
      it('should parse optional date-time', () => {
        const optionalDateTime = t.optional(t.format('date-time'));

        expect(parseValue(undefined, optionalDateTime, 'test')).toBeUndefined();
        expect(parseValue('2024-01-15T10:30:00Z', optionalDateTime, 'test')).toBeInstanceOf(Date);
      });

      it('should parse nullable date-time with value', () => {
        const nullableDateTime = t.nullable(t.format('date-time'));

        expect(parseValue('2024-01-15T10:30:00Z', nullableDateTime, 'test')).toBeInstanceOf(Date);
      });

      it('should parse nullish date with value', () => {
        const nullishDate = t.nullish(t.format('date'));

        expect(parseValue('2024-01-15', nullishDate, 'test')).toBeInstanceOf(Date);
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should parse optional date-time in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { deletedAt: undefined });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { deletedAt: t.optional(t.format('date-time')) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.deletedAt).toBeUndefined();
        });
      });

      it('should parse date in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { endDate: '2024-12-31' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { endDate: t.format('date') },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.endDate).toBeInstanceOf(Date);
        });
      });
    });

    describe('Entity integration', () => {
      const getContext = setupParsingTests();

      it('should parse nullable date-time in entity', async () => {
        const { client, kv } = getContext();

        const Task = entity(() => ({
          __typename: t.typename('Task'),
          id: t.id,
          completedAt: t.nullable(t.format('date-time')),
        }));

        const QueryResult = t.object({ task: Task });

        const result = {
          task: { __typename: 'Task', id: 1, completedAt: null },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Task', 1, Task.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).completedAt).toBeNull();
      });
    });
  });

  describe('custom formats', () => {
    // Register custom formats for testing
    registerFormat(
      'price',
      Mask.STRING,
      (value: string) => parseFloat(value.replace(/[$,]/g, '')),
      (value: number) => `$${value.toFixed(2)}`,
    );

    registerFormat(
      'percentage',
      Mask.STRING,
      (value: string) => parseFloat(value.replace('%', '')) / 100,
      (value: number) => `${(value * 100).toFixed(1)}%`,
    );

    registerFormat(
      'slug',
      Mask.STRING,
      (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      (value: string) => value,
    );

    registerFormat(
      'coordinates',
      Mask.STRING,
      (value: string) => {
        const [lat, lng] = value.split(',').map(Number);
        return { lat, lng };
      },
      (value: { lat: number; lng: number }) => `${value.lat},${value.lng}`,
    );

    describe('Direct parseValue', () => {
      describe('price format', () => {
        it('should parse price string to number', () => {
          const result = parseValue('$10.99', t.format('price'), 'test');
          expect(result).toBe(10.99);
          expect(typeof result).toBe('number');
        });

        it('should parse price with comma separators', () => {
          const result = parseValue('$1,234.56', t.format('price'), 'test');
          expect(result).toBe(1234.56);
        });

        it('should parse price without dollar sign', () => {
          const result = parseValue('99.99', t.format('price'), 'test');
          expect(result).toBe(99.99);
        });
      });

      describe('percentage format', () => {
        it('should parse percentage string to decimal', () => {
          const result = parseValue('50%', t.format('percentage'), 'test');
          expect(result).toBe(0.5);
        });

        it('should parse percentage with decimals', () => {
          const result = parseValue('33.3%', t.format('percentage'), 'test');
          expect(result).toBeCloseTo(0.333);
        });

        it('should parse 100%', () => {
          const result = parseValue('100%', t.format('percentage'), 'test');
          expect(result).toBe(1);
        });
      });

      describe('slug format', () => {
        it('should normalize string to slug', () => {
          const result = parseValue('Hello World', t.format('slug'), 'test');
          expect(result).toBe('hello-world');
        });

        it('should handle special characters', () => {
          const result = parseValue("What's Up?!", t.format('slug'), 'test');
          expect(result).toBe('what-s-up');
        });

        it('should trim leading/trailing hyphens', () => {
          const result = parseValue('---hello---', t.format('slug'), 'test');
          expect(result).toBe('hello');
        });
      });

      describe('coordinates format', () => {
        it('should parse coordinate string to object', () => {
          const result = parseValue('40.7128,-74.0060', t.format('coordinates'), 'test') as {
            lat: number;
            lng: number;
          };
          expect(result.lat).toBe(40.7128);
          expect(result.lng).toBe(-74.006);
        });

        it('should handle negative coordinates', () => {
          const result = parseValue('-33.8688,151.2093', t.format('coordinates'), 'test') as {
            lat: number;
            lng: number;
          };
          expect(result.lat).toBe(-33.8688);
          expect(result.lng).toBe(151.2093);
        });
      });

      describe('within object', () => {
        it('should parse custom formats in object', () => {
          const ProductType = t.object({
            price: t.format('price'),
            discount: t.format('percentage'),
          });

          const result = parseValue({ price: '$29.99', discount: '15%' }, ProductType, 'test') as any;

          expect(result.price).toBe(29.99);
          expect(result.discount).toBeCloseTo(0.15);
        });
      });

      describe('within array', () => {
        it('should parse array of custom formats', () => {
          const result = parseValue(['$10', '$20', '$30'], t.array(t.format('price')), 'test') as number[];

          expect(result).toEqual([10, 20, 30]);
        });
      });

      describe('within record', () => {
        it('should parse record of custom formats', () => {
          const result = parseValue(
            { small: '$9.99', medium: '$14.99', large: '$19.99' },
            t.record(t.format('price')),
            'test',
          ) as Record<string, number>;

          expect(result.small).toBe(9.99);
          expect(result.medium).toBe(14.99);
          expect(result.large).toBe(19.99);
        });
      });

      describe('with nullable', () => {
        it('should parse nullable custom format with value', () => {
          const nullablePrice = t.nullable(t.format('price'));

          const result = parseValue('$50', nullablePrice, 'test');
          expect(result).toBe(50);
        });

        it('should handle null with null-safe custom format', () => {
          // Custom format parser that handles null
          registerFormat(
            'safeprice' as any,
            Mask.STRING,
            (value: string) => (value === null ? null : parseFloat(String(value).replace(/[$,]/g, '')))!,
            (value: number) => (value === null ? null : `$${value.toFixed(2)}`)!,
          );

          const nullablePrice = t.nullable(t.format('safeprice' as any));

          const result1 = parseValue('$50', nullablePrice, 'test');
          expect(result1).toBe(50);

          const result2 = parseValue(null, nullablePrice, 'test');
          expect(result2).toBeNull();
        });
      });

      describe('with optional', () => {
        it('should parse optional custom format', () => {
          const optionalPrice = t.optional(t.format('price'));

          const result1 = parseValue('$50', optionalPrice, 'test');
          expect(result1).toBe(50);

          const result2 = parseValue(undefined, optionalPrice, 'test');
          expect(result2).toBeUndefined();
        });
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should parse custom format in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/product', { price: '$49.99', discount: '20%' });

        await testWithClient(client, async () => {
          const getProduct = query(() => ({
            path: '/product',
            response: {
              price: t.format('price'),
              discount: t.format('percentage'),
            },
          }));

          const relay = getProduct();
          const result = await relay;

          expect(result.price).toBe(49.99);
          expect(result.discount).toBeCloseTo(0.2);
        });
      });

      it('should parse array of custom formats in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/prices', { prices: ['$10', '$20', '$30'] });

        await testWithClient(client, async () => {
          const getPrices = query(() => ({
            path: '/prices',
            response: { prices: t.array(t.format('price')) },
          }));

          const relay = getPrices();
          const result = await relay;

          expect(result.prices).toEqual([10, 20, 30]);
        });
      });

      it('should parse record of custom formats in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/rates', {
          rates: { tax: '8.5%', tip: '18%', service: '5%' },
        });

        await testWithClient(client, async () => {
          const getRates = query(() => ({
            path: '/rates',
            response: { rates: t.record(t.format('percentage')) },
          }));

          const relay = getRates();
          const result = await relay;

          expect(result.rates.tax).toBeCloseTo(0.085);
          expect(result.rates.tip).toBeCloseTo(0.18);
          expect(result.rates.service).toBeCloseTo(0.05);
        });
      });

      it('should parse coordinates format in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/location', { location: '37.7749,-122.4194' });

        await testWithClient(client, async () => {
          const getLocation = query(() => ({
            path: '/location',
            response: { location: t.format('coordinates') },
          }));

          const relay = getLocation();
          const result = await relay;

          expect((result.location as any).lat).toBe(37.7749);
          expect((result.location as any).lng).toBe(-122.4194);
        });
      });
    });

    describe('Entity integration', () => {
      const getContext = setupParsingTests();

      it('should parse custom format field in entity', async () => {
        const { client, kv } = getContext();

        const Product = entity(() => ({
          __typename: t.typename('Product'),
          id: t.id,
          price: t.format('price'),
        }));

        const QueryResult = t.object({ product: Product });

        const result = {
          product: { __typename: 'Product', id: 1, price: '$99.99' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Product', 1, Product.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        // Entity stores raw string value
        expect((doc as any).price).toBe('$99.99');
      });

      it('should parse entity with multiple custom format fields', async () => {
        const { client, kv } = getContext();

        const Sale = entity(() => ({
          __typename: t.typename('Sale'),
          id: t.id,
          price: t.format('price'),
          discount: t.format('percentage'),
          slug: t.format('slug'),
        }));

        const QueryResult = t.object({ sale: Sale });

        const result = {
          sale: {
            __typename: 'Sale',
            id: 1,
            price: '$49.99',
            discount: '10%',
            slug: 'Summer Sale 2024',
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Sale', 1, Sale.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });

      it('should parse array of entities with custom formats', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          price: t.format('price'),
        }));

        const QueryResult = t.object({ items: t.array(Item) });

        const result = {
          items: [
            { __typename: 'Item', id: 1, price: '$10' },
            { __typename: 'Item', id: 2, price: '$20' },
            { __typename: 'Item', id: 3, price: '$30' },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key1 = getEntityKey('Item', 1, Item.shapeKey);
        const key2 = getEntityKey('Item', 2, Item.shapeKey);
        const key3 = getEntityKey('Item', 3, Item.shapeKey);

        expect(await getDocument(kv, key1)).toBeDefined();
        expect(await getDocument(kv, key2)).toBeDefined();
        expect(await getDocument(kv, key3)).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should throw for unregistered format', () => {
        expect(() => {
          t.format('unknown-format' as any);
        }).toThrow('Format unknown-format not registered');
      });

      it('should handle empty string input', () => {
        const result = parseValue('', t.format('slug'), 'test');
        expect(result).toBe('');
      });

      it('should handle complex nested structures', () => {
        const OrderType = t.object({
          items: t.array(
            t.object({
              name: t.string,
              price: t.format('price'),
              quantity: t.number,
            }),
          ),
          total: t.format('price'),
          discount: t.nullable(t.format('percentage')),
        });

        const result = parseValue(
          {
            items: [
              { name: 'Widget', price: '$10', quantity: 2 },
              { name: 'Gadget', price: '$25', quantity: 1 },
            ],
            total: '$45',
            discount: '10%',
          },
          OrderType,
          'test',
        ) as any;

        expect(result.items[0].price).toBe(10);
        expect(result.items[1].price).toBe(25);
        expect(result.total).toBe(45);
        expect(result.discount).toBeCloseTo(0.1);
      });
    });
  });

  describe('edge cases', () => {
    it('should throw for invalid format', () => {
      expect(() => parseValue('invalid', t.format('date-time'), 'test')).toThrow('Invalid date-time string');
    });

    it('should handle boundary dates', () => {
      // Year 0
      const result1 = parseValue('0001-01-01', t.format('date'), 'test');
      expect(result1).toBeInstanceOf(Date);

      // Far future
      const result2 = parseValue('9999-12-31', t.format('date'), 'test');
      expect(result2).toBeInstanceOf(Date);
    });
  });
});
