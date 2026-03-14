import { describe, it, expect, vi } from 'vitest';
import { t } from '../../typeDefs.js';
import { Entity, parseValue } from '../../proxy.js';
import { Query, getQuery } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getShapeKey } from './test-utils.js';

/**
 * t.optional Tests
 *
 * Tests for optional type modifier (T | undefined) across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.optional', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse undefined for optional type', () => {
        expect(parseValue(undefined, t.optional(t.string), 'test')).toBe(undefined);
      });

      it('should parse value for optional type', () => {
        expect(parseValue('hello', t.optional(t.string), 'test')).toBe('hello');
        expect(parseValue(42, t.optional(t.number), 'test')).toBe(42);
        expect(parseValue(true, t.optional(t.boolean), 'test')).toBe(true);
      });

      it('should handle valid optional values', () => {
        const optionalString = t.optional(t.string);
        expect(parseValue('hello', optionalString, 'test')).toBe('hello');
        expect(parseValue(undefined, optionalString, 'test')).toBeUndefined();
      });
    });

    describe('within object', () => {
      it('should parse optional fields in objects', () => {
        const objType = t.object({
          name: t.string,
          nickname: t.optional(t.string),
        });

        const result1 = parseValue({ name: 'Alice', nickname: 'Ali' }, objType, 'test') as any;
        expect(result1.name).toBe('Alice');
        expect(result1.nickname).toBe('Ali');

        const result2 = parseValue({ name: 'Bob', nickname: undefined }, objType, 'test') as any;
        expect(result2.name).toBe('Bob');
        expect(result2.nickname).toBeUndefined();
      });

      it('should parse missing optional field as undefined', () => {
        const objType = t.object({
          name: t.string,
          nickname: t.optional(t.string),
        });

        const result = parseValue({ name: 'Alice' }, objType, 'test') as any;
        expect(result.name).toBe('Alice');
        expect(result.nickname).toBeUndefined();
      });
    });

    describe('within array', () => {
      it('should parse array of optional values', () => {
        const result = parseValue(['a', undefined, 'b'], t.array(t.optional(t.string)), 'test');
        expect(result).toEqual(['a', undefined, 'b']);
      });
    });

    describe('within record', () => {
      it('should parse record with optional values', () => {
        const result = parseValue({ a: 'hello', b: undefined, c: 'world' }, t.record(t.optional(t.string)), 'test');
        expect(result).toEqual({ a: 'hello', b: undefined, c: 'world' });
      });
    });

    describe('within union', () => {
      it('should parse optional type in union', () => {
        const unionType = t.union(t.optional(t.string), t.number);
        expect(parseValue(undefined, unionType, 'test')).toBe(undefined);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });
    });

    describe('edge cases', () => {
      it('should handle nested optional types', () => {
        const nestedOptional = t.optional(t.optional(t.string));
        expect(parseValue(undefined, nestedOptional, 'test')).toBe(undefined);
        expect(parseValue('hello', nestedOptional, 'test')).toBe('hello');
      });

      it('should handle optional complex types', () => {
        const optionalObj = t.optional(t.object({ id: t.number }));
        expect(parseValue(undefined, optionalObj, 'test')).toBe(undefined);
        expect(parseValue({ id: 1 }, optionalObj, 'test')).toEqual({ id: 1 });
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse optional field in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { optional: undefined });

        await testWithClient(client, async () => {
          class GetItem extends Query {
            path = '/item';
            response = { optional: t.optional(t.string) };
          }

          const relay = getQuery(GetItem);
          const result = await relay;

          expect(result.optional).toBeUndefined();
        });
      });

      it('should parse present optional field', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { optional: 'value' });

        await testWithClient(client, async () => {
          class GetItem extends Query {
            path = '/item';
            response = { optional: t.optional(t.string) };
          }

          const relay = getQuery(GetItem);
          const result = await relay;

          expect(result.optional).toBe('value');
        });
      });
    });

    describe('within object', () => {
      it('should parse optional in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { name: 'Alice', bio: undefined },
        });

        await testWithClient(client, async () => {
          class GetUser extends Query {
            path = '/user';
            response = {
              user: t.object({
                name: t.string,
                bio: t.optional(t.string),
              }),
            };
          }

          const relay = getQuery(GetUser);
          const result = await relay;

          expect(result.user.name).toBe('Alice');
          expect(result.user.bio).toBeUndefined();
        });
      });
    });

    describe('within array', () => {
      it('should parse array with optional values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: ['a', undefined, 'b'] });

        await testWithClient(client, async () => {
          class GetItems extends Query {
            path = '/items';
            response = { items: t.array(t.optional(t.string)) };
          }

          const relay = getQuery(GetItems);
          const result = await relay;

          expect(result.items).toEqual(['a', undefined, 'b']);
        });
      });
    });

    describe('within record', () => {
      it('should parse record with optional values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          values: { a: 'hello', b: undefined },
        });

        await testWithClient(client, async () => {
          class GetData extends Query {
            path = '/data';
            response = { values: t.record(t.optional(t.string)) };
          }

          const relay = getQuery(GetData);
          const result = await relay;

          expect(result.values.a).toBe('hello');
          expect(result.values.b).toBeUndefined();
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse optional field in entity', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          nickname = t.optional(t.string);
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 1, nickname: undefined },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, getShapeKey(t.entity(User)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        // Note: undefined may not be stored in JSON serialization
      });

      it('should parse present optional field in entity', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          nickname = t.optional(t.string);
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 1, nickname: 'Ali' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, getShapeKey(t.entity(User)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).nickname).toBe('Ali');
      });
    });

    describe('within object', () => {
      it('should parse optional in nested object within entity', async () => {
        const { client, kv } = getContext();

        class Profile extends Entity {
          __typename = t.typename('Profile');
          id = t.id;
          details = t.object({
            bio: t.optional(t.string),
            website: t.optional(t.string),
          });
        }

        const QueryResult = t.object({ profile: t.entity(Profile) });

        const result = {
          profile: {
            __typename: 'Profile',
            id: 1,
            details: { bio: 'Hello', website: undefined },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Profile', 1, getShapeKey(t.entity(Profile)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).details.bio).toBe('Hello');
      });
    });

    describe('within array', () => {
      it('should parse optional array in entity', async () => {
        const { client, kv } = getContext();

        class Post extends Entity {
          __typename = t.typename('Post');
          id = t.id;
          tags = t.optional(t.array(t.string));
        }

        const QueryResult = t.object({ post: t.entity(Post) });

        const result = {
          post: {
            __typename: 'Post',
            id: 1,
            tags: ['tech', 'coding'],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Post', 1, getShapeKey(t.entity(Post)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).tags).toEqual(['tech', 'coding']);
      });
    });

    describe('within record', () => {
      it('should parse optional record in entity', async () => {
        const { client, kv } = getContext();

        class Config extends Entity {
          __typename = t.typename('Config');
          id = t.id;
          metadata = t.optional(t.record(t.string));
        }

        const QueryResult = t.object({ config: t.entity(Config) });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            metadata: { key: 'value' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, getShapeKey(t.entity(Config)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).metadata).toEqual({ key: 'value' });
      });
    });
  });

  describe('undefined fallback on parse failure', () => {
    describe('Direct parseValue', () => {
      it('should return undefined for optional field with invalid enum', () => {
        const warnLogger = vi.fn();
        const OptionalStatus = t.optional(t.enum('active', 'inactive'));

        const result = parseValue('unknown_status', OptionalStatus, 'test.status', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalledWith(
          'Invalid value for optional type, defaulting to undefined',
          expect.objectContaining({ value: 'unknown_status', path: 'test.status' }),
        );
      });

      it('should return undefined for optional field with wrong type', () => {
        const warnLogger = vi.fn();
        const OptionalNumber = t.optional(t.number);

        const result = parseValue('not a number', OptionalNumber, 'test.count', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalled();
      });

      it('should return undefined for optional field with invalid date format', () => {
        const warnLogger = vi.fn();
        const OptionalDate = t.optional(t.format('date'));

        const result = parseValue('not-a-date', OptionalDate, 'test.date', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalledWith(
          'Invalid formatted value for optional type, defaulting to undefined',
          expect.objectContaining({ path: 'test.date' }),
        );
      });

      it('should receive correct context in warn logger', () => {
        const warnLogger = vi.fn();
        const OptionalNumber = t.optional(t.number);

        parseValue('bad', OptionalNumber, 'my.path', false, warnLogger);

        expect(warnLogger).toHaveBeenCalledWith(
          'Invalid value for optional type, defaulting to undefined',
          expect.objectContaining({
            value: 'bad',
            path: 'my.path',
          }),
        );
      });

      it('should fall back to undefined even without warn logger', () => {
        const OptionalNumber = t.optional(t.number);

        const result = parseValue('not a number', OptionalNumber, 'test.count');
        expect(result).toBeUndefined();
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should return undefined for optional fields with invalid values in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', {
          name: 'Test',
          status: 'unknown_new_status',
          count: 'not a number',
        });

        await testWithClient(client, async () => {
          class GetItem extends Query {
            path = '/item';
            response = {
              name: t.string,
              status: t.optional(t.enum('active', 'inactive')),
              count: t.optional(t.number),
            };
          }

          const relay = getQuery(GetItem);
          const result = await relay;

          expect(result.name).toBe('Test');
          expect(result.status).toBeUndefined();
          expect(result.count).toBeUndefined();
        });
      });
    });
  });
});
