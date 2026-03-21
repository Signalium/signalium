import { describe, it, expect } from 'vitest';
import { t } from '../../typeDefs.js';
import { Entity } from '../../proxy.js';
import { RESTQuery, fetchQuery } from '../../query.js';
import {
  parseValue,
  parseEntities,
  setupParsingTests,
  testWithClient,
  getEntityKey,
  getDocument,
} from './test-utils.js';

/**
 * t.undefined Tests
 *
 * Tests for undefined type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.undefined', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse undefined value', () => {
        expect(parseValue(undefined, t.undefined, 'test')).toBe(undefined);
      });

      it('should accept undefined value', () => {
        expect(parseValue(undefined, t.undefined, 'test')).toBeUndefined();
      });
    });

    describe('within object', () => {
      it('should parse undefined field in object', () => {
        const objType = t.object({ value: t.undefined });
        const result = parseValue({ value: undefined }, objType, 'test') as { value: undefined };

        expect(result.value).toBe(undefined);
      });

      it('should parse missing field as undefined', () => {
        const objType = t.object({ value: t.undefined });
        const result = parseValue({}, objType, 'test') as { value: undefined };

        expect(result.value).toBeUndefined();
      });
    });

    describe('within array', () => {
      it('should parse array of undefined values', () => {
        const result = parseValue([undefined, undefined], t.array(t.undefined), 'test');
        expect(result).toEqual([undefined, undefined]);
      });

      it('should parse empty undefined array', () => {
        const result = parseValue([], t.array(t.undefined), 'test');
        expect(result).toEqual([]);
      });

      it('should parse array with undefined', () => {
        const result = parseValue([undefined, undefined], t.array(t.undefined), 'test');
        expect(result).toEqual([undefined, undefined]);
      });
    });

    describe('within record', () => {
      it('should parse record of undefined values', () => {
        const result = parseValue({ a: undefined, b: undefined }, t.record(t.undefined), 'test');
        expect(result).toEqual({ a: undefined, b: undefined });
      });
    });

    describe('within union', () => {
      it('should parse undefined in union', () => {
        const unionType = t.union(t.string, t.undefined);
        expect(parseValue(undefined, unionType, 'test')).toBe(undefined);
      });

      it('should parse defined value in union', () => {
        const unionType = t.union(t.string, t.undefined);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });

    describe('edge cases', () => {
      it('should handle undefined type', () => {
        expect(parseValue(undefined, t.undefined, 'test')).toBeUndefined();
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse undefined in query response with union', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: undefined });

        await testWithClient(client, async () => {
          class GetItem extends RESTQuery {
            path = '/item';
            result = { value: t.union(t.string, t.undefined) };
          }

          const relay = fetchQuery(GetItem);
          const result = await relay;

          expect(result.value).toBeUndefined();
        });
      });
    });

    describe('within object', () => {
      it('should parse undefined in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          data: { nested: { value: undefined } },
        });

        await testWithClient(client, async () => {
          class GetData extends RESTQuery {
            path = '/data';
            result = {
              data: t.object({
                nested: t.object({
                  value: t.union(t.string, t.undefined),
                }),
              }),
            };
          }

          const relay = fetchQuery(GetData);
          const result = await relay;

          expect(result.data.nested.value).toBeUndefined();
        });
      });
    });

    describe('within array', () => {
      it('should parse array with undefined values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: ['a', undefined, 'b', undefined] });

        await testWithClient(client, async () => {
          class GetItems extends RESTQuery {
            path = '/items';
            result = { items: t.array(t.union(t.string, t.undefined)) };
          }

          const relay = fetchQuery(GetItems);
          const result = await relay;

          expect(result.items).toEqual(['a', undefined, 'b', undefined]);
        });
      });
    });

    describe('within record', () => {
      it('should parse record with undefined values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          values: { a: 'hello', b: undefined, c: 'world' },
        });

        await testWithClient(client, async () => {
          class GetData extends RESTQuery {
            path = '/data';
            result = { values: t.record(t.union(t.string, t.undefined)) };
          }

          const relay = fetchQuery(GetData);
          const result = await relay;

          expect(result.values.a).toBe('hello');
          expect(result.values.b).toBeUndefined();
          expect(result.values.c).toBe('world');
        });
      });
    });

    describe('within union', () => {
      it('should distinguish undefined from string in union', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/value1', { value: undefined });
        mockFetch.get('/value2', { value: 'text' });

        await testWithClient(client, async () => {
          class GetValue1 extends RESTQuery {
            path = '/value1';
            result = { value: t.union(t.string, t.undefined) };
          }

          class GetValue2 extends RESTQuery {
            path = '/value2';
            result = { value: t.union(t.string, t.undefined) };
          }

          const relay1 = fetchQuery(GetValue1);
          const result1 = await relay1;
          expect(result1.value).toBeUndefined();

          const relay2 = fetchQuery(GetValue2);
          const result2 = await relay2;
          expect(result2.value).toBe('text');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse undefined field in entity with union', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          nickname = t.union(t.string, t.undefined);
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 1, nickname: undefined },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });

    describe('within object', () => {
      it('should parse undefined in nested object within entity', async () => {
        const { client, kv } = getContext();

        class Profile extends Entity {
          __typename = t.typename('Profile');
          id = t.id;
          metadata = t.object({
            avatar: t.union(t.string, t.undefined),
          });
        }

        const QueryResult = t.object({ profile: t.entity(Profile) });

        const result = {
          profile: {
            __typename: 'Profile',
            id: 1,
            metadata: { avatar: undefined },
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Profile', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });

    describe('within array', () => {
      it('should parse array with undefined values in entity', async () => {
        const { client, kv } = getContext();

        class Container extends Entity {
          __typename = t.typename('Container');
          id = t.id;
          items = t.array(t.union(t.string, t.undefined));
        }

        const QueryResult = t.object({ container: t.entity(Container) });

        const result = {
          container: {
            __typename: 'Container',
            id: 1,
            items: ['a', undefined, 'b'],
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Container', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });

    describe('within record', () => {
      it('should parse record with undefined values in entity', async () => {
        const { client, kv } = getContext();

        class Config extends Entity {
          __typename = t.typename('Config');
          id = t.id;
          settings = t.record(t.union(t.string, t.undefined));
        }

        const QueryResult = t.object({ config: t.entity(Config) });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { theme: 'dark', custom: undefined },
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });

    describe('within union', () => {
      it('should parse undefined in union field of entity', async () => {
        const { client, kv } = getContext();

        class Item extends Entity {
          __typename = t.typename('Item');
          id = t.id;
          value = t.union(t.string, t.number, t.undefined);
        }

        const QueryResult = t.object({ item: t.entity(Item) });

        const result = {
          item: {
            __typename: 'Item',
            id: 1,
            value: undefined,
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Item', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
      });
    });
  });
});
