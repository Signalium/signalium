import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.null Tests
 *
 * Tests for null type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.null', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse null value', () => {
        expect(parseValue(null, t.null, 'test')).toBe(null);
      });

      it('should throw for non-null values', () => {
        expect(() => parseValue(undefined, t.null, 'test')).toThrow('expected null, got undefined');
        expect(() => parseValue('', t.null, 'test')).toThrow('expected null, got string');
        expect(() => parseValue(0, t.null, 'test')).toThrow('expected null, got number');
        expect(() => parseValue(false, t.null, 'test')).toThrow('expected null, got boolean');
        expect(() => parseValue({}, t.null, 'test')).toThrow('expected null, got object');
        expect(() => parseValue([], t.null, 'test')).toThrow('expected null, got array');
      });
    });

    describe('within object', () => {
      it('should parse null field in object', () => {
        const objType = t.object({ value: t.null });
        const result = parseValue({ value: null }, objType, 'test') as { value: null };

        expect(result.value).toBe(null);
      });

      it('should throw for non-null field in object expecting null', () => {
        const objType = t.object({ value: t.null });

        expect(() => parseValue({ value: 'not null' }, objType, 'test')).toThrow('expected null, got string');
      });
    });

    describe('within array', () => {
      it('should parse array of nulls', () => {
        const result = parseValue([null, null, null], t.array(t.null), 'test');
        expect(result).toEqual([null, null, null]);
      });

      it('should parse empty null array', () => {
        const result = parseValue([], t.array(t.null), 'test');
        expect(result).toEqual([]);
      });

      it('should filter non-null items in array with warning callback', () => {
        const result = parseValue([null, 'invalid', null], t.array(t.null), 'test', false, () => {});
        expect(result).toEqual([null, null]);
      });
    });

    describe('within record', () => {
      it('should parse record of nulls', () => {
        const result = parseValue({ a: null, b: null }, t.record(t.null), 'test');
        expect(result).toEqual({ a: null, b: null });
      });

      it('should throw for non-null value in record', () => {
        expect(() => parseValue({ a: null, b: 'not null' }, t.record(t.null), 'test')).toThrow(
          'expected null, got string',
        );
      });
    });

    describe('within union', () => {
      it('should parse null in union', () => {
        const unionType = t.union(t.string, t.null);
        expect(parseValue(null, unionType, 'test')).toBe(null);
      });

      it('should parse non-null value in union', () => {
        const unionType = t.union(t.string, t.null);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });

    describe('edge cases', () => {
      it('should show correct error path', () => {
        expect(() => parseValue(undefined, t.null, 'GET:/data.required')).toThrow(
          'Validation error at GET:/data.required: expected null, got undefined',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse null in query response with union', async () => {
        const { client, mockFetch } = getContext();
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
    });

    describe('within object', () => {
      it('should parse null in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          data: { nested: { value: null } },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: {
              data: t.object({
                nested: t.object({
                  value: t.union(t.string, t.null),
                }),
              }),
            },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.data.nested.value).toBeNull();
        });
      });
    });

    describe('within array', () => {
      it('should parse array with null values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: ['a', null, 'b', null] });

        await testWithClient(client, async () => {
          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(t.union(t.string, t.null)) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toEqual(['a', null, 'b', null]);
        });
      });
    });

    describe('within record', () => {
      it('should parse record with null values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          values: { a: 'hello', b: null, c: 'world' },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: { values: t.record(t.union(t.string, t.null)) },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.values.a).toBe('hello');
          expect(result.values.b).toBeNull();
          expect(result.values.c).toBe('world');
        });
      });
    });

    describe('within union', () => {
      it('should distinguish null from string in union', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/value1', { value: null });
        mockFetch.get('/value2', { value: 'text' });

        await testWithClient(client, async () => {
          const getValue1 = query(() => ({
            path: '/value1',
            response: { value: t.union(t.string, t.null) },
          }));

          const getValue2 = query(() => ({
            path: '/value2',
            response: { value: t.union(t.string, t.null) },
          }));

          const relay1 = getValue1();
          const result1 = await relay1;
          expect(result1.value).toBeNull();

          const relay2 = getValue2();
          const result2 = await relay2;
          expect(result2.value).toBe('text');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse null field in entity with union', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          nickname: t.union(t.string, t.null),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, nickname: null },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).nickname).toBeNull();
      });
    });

    describe('within object', () => {
      it('should parse null in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Profile = entity(() => ({
          __typename: t.typename('Profile'),
          id: t.id,
          metadata: t.object({
            avatar: t.union(t.string, t.null),
          }),
        }));

        const QueryResult = t.object({ profile: Profile });

        const result = {
          profile: {
            __typename: 'Profile',
            id: 1,
            metadata: { avatar: null },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Profile', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).metadata.avatar).toBeNull();
      });
    });

    describe('within array', () => {
      it('should parse array with null values in entity', async () => {
        const { client, kv } = getContext();

        const Container = entity(() => ({
          __typename: t.typename('Container'),
          id: t.id,
          items: t.array(t.union(t.string, t.null)),
        }));

        const QueryResult = t.object({ container: Container });

        const result = {
          container: {
            __typename: 'Container',
            id: 1,
            items: ['a', null, 'b'],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Container', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).items).toEqual(['a', null, 'b']);
      });
    });

    describe('within record', () => {
      it('should parse record with null values in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.record(t.union(t.string, t.null)),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { theme: 'dark', custom: null },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings).toEqual({ theme: 'dark', custom: null });
      });
    });

    describe('within union', () => {
      it('should parse null in union field of entity', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          value: t.union(t.string, t.number, t.null),
        }));

        const QueryResult = t.object({ item: Item });

        const result = {
          item: {
            __typename: 'Item',
            id: 1,
            value: null,
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Item', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toBeNull();
      });
    });
  });
});
