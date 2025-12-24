import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.nullable Tests
 *
 * Tests for nullable type modifier (T | null) across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.nullable', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse null for nullable type', () => {
        expect(parseValue(null, t.nullable(t.string), 'test')).toBe(null);
      });

      it('should parse value for nullable type', () => {
        expect(parseValue('hello', t.nullable(t.string), 'test')).toBe('hello');
        expect(parseValue(42, t.nullable(t.number), 'test')).toBe(42);
        expect(parseValue(true, t.nullable(t.boolean), 'test')).toBe(true);
      });

      it('should throw for undefined when only nullable (not optional)', () => {
        expect(() => parseValue(undefined, t.nullable(t.string), 'test')).toThrow(
          /expected null \| string, got undefined/,
        );
      });

      it('should throw for wrong type', () => {
        expect(() => parseValue(42, t.nullable(t.string), 'test')).toThrow(/expected null \| string, got number/);
      });
    });

    describe('within object', () => {
      it('should parse nullable fields in objects', () => {
        const objType = t.object({
          name: t.string,
          nickname: t.nullable(t.string),
        });

        const result1 = parseValue({ name: 'Alice', nickname: 'Ali' }, objType, 'test') as any;
        expect(result1.name).toBe('Alice');
        expect(result1.nickname).toBe('Ali');

        const result2 = parseValue({ name: 'Bob', nickname: null }, objType, 'test') as any;
        expect(result2.name).toBe('Bob');
        expect(result2.nickname).toBeNull();
      });
    });

    describe('within array', () => {
      it('should parse array of nullable values', () => {
        const result = parseValue(['a', null, 'b'], t.array(t.nullable(t.string)), 'test');
        expect(result).toEqual(['a', null, 'b']);
      });
    });

    describe('within record', () => {
      it('should parse record with nullable values', () => {
        const result = parseValue({ a: 'hello', b: null, c: 'world' }, t.record(t.nullable(t.string)), 'test');
        expect(result).toEqual({ a: 'hello', b: null, c: 'world' });
      });
    });

    describe('within union', () => {
      it('should parse nullable type in union', () => {
        const unionType = t.union(t.nullable(t.string), t.number);
        expect(parseValue(null, unionType, 'test')).toBe(null);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });
    });

    describe('edge cases', () => {
      it('should show correct error path', () => {
        expect(() => parseValue(undefined, t.nullable(t.string), 'GET:/user.nickname')).toThrow(
          /Validation error at GET:\/user\.nickname: expected null \| string, got undefined/,
        );
      });

      it('should handle nested nullable types', () => {
        const nestedNullable = t.nullable(t.nullable(t.string));
        expect(parseValue(null, nestedNullable, 'test')).toBe(null);
        expect(parseValue('hello', nestedNullable, 'test')).toBe('hello');
      });

      it('should handle nullable complex types', () => {
        const nullableObj = t.nullable(t.object({ id: t.number }));
        expect(parseValue(null, nullableObj, 'test')).toBe(null);
        expect(parseValue({ id: 1 }, nullableObj, 'test')).toEqual({ id: 1 });
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse null value in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: null });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.nullable(t.string) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBeNull();
        });
      });

      it('should parse non-null nullable field', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: 'present' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.nullable(t.string) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBe('present');
        });
      });
    });

    describe('within object', () => {
      it('should parse nullable in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { name: 'Alice', deletedAt: null },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                name: t.string,
                deletedAt: t.nullable(t.string),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.name).toBe('Alice');
          expect(result.user.deletedAt).toBeNull();
        });
      });
    });

    describe('within array', () => {
      it('should parse array with nullable values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: ['a', null, 'b', null] });

        await testWithClient(client, async () => {
          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(t.nullable(t.string)) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toEqual(['a', null, 'b', null]);
        });
      });
    });

    describe('within record', () => {
      it('should parse record with nullable values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          values: { a: 'hello', b: null, c: 'world' },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: { values: t.record(t.nullable(t.string)) },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.values.a).toBe('hello');
          expect(result.values.b).toBeNull();
          expect(result.values.c).toBe('world');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse nullable field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          deletedAt: t.nullable(t.string),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, deletedAt: null },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).deletedAt).toBeNull();
      });

      it('should parse non-null nullable field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          deletedAt: t.nullable(t.string),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, deletedAt: '2024-01-15' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).deletedAt).toBe('2024-01-15');
      });
    });

    describe('within object', () => {
      it('should parse nullable in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Profile = entity(() => ({
          __typename: t.typename('Profile'),
          id: t.id,
          details: t.object({
            bio: t.nullable(t.string),
            website: t.nullable(t.string),
          }),
        }));

        const QueryResult = t.object({ profile: Profile });

        const result = {
          profile: {
            __typename: 'Profile',
            id: 1,
            details: { bio: null, website: 'https://example.com' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Profile', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).details.bio).toBeNull();
        expect((doc as any).details.website).toBe('https://example.com');
      });
    });

    describe('within array', () => {
      it('should parse nullable array in entity', async () => {
        const { client, kv } = getContext();

        const Post = entity(() => ({
          __typename: t.typename('Post'),
          id: t.id,
          tags: t.nullable(t.array(t.string)),
        }));

        const QueryResult = t.object({ post: Post });

        const result = {
          post: {
            __typename: 'Post',
            id: 1,
            tags: null,
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Post', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).tags).toBeNull();
      });
    });

    describe('within record', () => {
      it('should parse record with nullable values in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.record(t.nullable(t.string)),
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
  });

  describe('no fallback on parse failure (nullable is explicit)', () => {
    describe('Direct parseValue', () => {
      it('should throw for nullable field with invalid value', () => {
        const NullableNumber = t.nullable(t.number);

        // Nullable does NOT fallback - null is an explicit value, not a default
        expect(() => parseValue('not a number', NullableNumber, 'test.count')).toThrow(/Validation error/);
      });

      it('should throw for nullable enum with unknown value', () => {
        const NullableStatus = t.nullable(t.enum('active', 'inactive'));

        expect(() => parseValue('unknown', NullableStatus, 'test.status')).toThrow(/Validation error/);
      });

      it('should throw for nullable date with invalid format', () => {
        const NullableDate = t.nullable(t.format('date'));

        expect(() => parseValue('not-a-date', NullableDate, 'test.date')).toThrow();
      });

      it('should accept null for nullable type', () => {
        const NullableString = t.nullable(t.string);

        const result = parseValue(null, NullableString, 'test');

        expect(result).toBeNull();
      });

      it('should throw for undefined on nullable type (only null is allowed)', () => {
        const NullableString = t.nullable(t.string);

        // undefined is not valid for nullable (only null is)
        expect(() => parseValue(undefined, NullableString, 'test')).toThrow(/Validation error/);
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should throw for nullable fields with invalid values in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', {
          count: 'not a number', // Wrong type
        });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              count: t.nullable(t.number),
            },
          }));

          const relay = getItem();

          await expect(relay).rejects.toThrow(/Validation error/);
        });
      });
    });
  });
});
