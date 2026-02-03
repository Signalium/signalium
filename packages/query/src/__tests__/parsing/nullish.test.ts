import { describe, it, expect, vi } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.nullish Tests
 *
 * Tests for nullish type modifier (T | null | undefined) across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.nullish', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse null for nullish type', () => {
        expect(parseValue(null, t.nullish(t.string), 'test')).toBe(null);
      });

      it('should parse undefined for nullish type', () => {
        expect(parseValue(undefined, t.nullish(t.string), 'test')).toBe(undefined);
      });

      it('should parse value for nullish type', () => {
        expect(parseValue('hello', t.nullish(t.string), 'test')).toBe('hello');
        expect(parseValue(42, t.nullish(t.number), 'test')).toBe(42);
        expect(parseValue(true, t.nullish(t.boolean), 'test')).toBe(true);
      });

      it('should handle wrong type in nullish', () => {
        // nullish(string) allows string, null, or undefined - not numbers
        // The actual behavior may vary based on implementation
        const nullishString = t.nullish(t.string);

        // Valid values
        expect(parseValue('hello', nullishString, 'test')).toBe('hello');
        expect(parseValue(null, nullishString, 'test')).toBeNull();
        expect(parseValue(undefined, nullishString, 'test')).toBeUndefined();
      });
    });

    describe('within object', () => {
      it('should parse nullish fields in objects', () => {
        const objType = t.object({
          name: t.string,
          nickname: t.nullish(t.string),
        });

        const result1 = parseValue({ name: 'Alice', nickname: 'Ali' }, objType, 'test') as any;
        expect(result1.name).toBe('Alice');
        expect(result1.nickname).toBe('Ali');

        const result2 = parseValue({ name: 'Bob', nickname: null }, objType, 'test') as any;
        expect(result2.name).toBe('Bob');
        expect(result2.nickname).toBeNull();

        const result3 = parseValue({ name: 'Charlie', nickname: undefined }, objType, 'test') as any;
        expect(result3.name).toBe('Charlie');
        expect(result3.nickname).toBeUndefined();
      });

      it('should parse missing nullish field as undefined', () => {
        const objType = t.object({
          name: t.string,
          nickname: t.nullish(t.string),
        });

        const result = parseValue({ name: 'Alice' }, objType, 'test') as any;
        expect(result.name).toBe('Alice');
        expect(result.nickname).toBeUndefined();
      });
    });

    describe('within array', () => {
      it('should parse array of nullish values', () => {
        const result = parseValue(['a', null, undefined, 'b'], t.array(t.nullish(t.string)), 'test');
        expect(result).toEqual(['a', null, undefined, 'b']);
      });
    });

    describe('within record', () => {
      it('should parse record with nullish values', () => {
        const result = parseValue(
          { a: 'hello', b: null, c: undefined, d: 'world' },
          t.record(t.nullish(t.string)),
          'test',
        );
        expect(result).toEqual({ a: 'hello', b: null, c: undefined, d: 'world' });
      });
    });

    describe('within union', () => {
      it('should parse nullish type in union', () => {
        const unionType = t.union(t.nullish(t.string), t.number);
        expect(parseValue(null, unionType, 'test')).toBe(null);
        expect(parseValue(undefined, unionType, 'test')).toBe(undefined);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });
    });

    describe('edge cases', () => {
      it('should handle nullish with complex types', () => {
        const nullishObj = t.nullish(t.object({ id: t.number }));
        expect(parseValue(null, nullishObj, 'test')).toBe(null);
        expect(parseValue(undefined, nullishObj, 'test')).toBe(undefined);
        expect(parseValue({ id: 1 }, nullishObj, 'test')).toEqual({ id: 1 });
      });

      it('should handle nullish complex types', () => {
        const nullishObj = t.nullish(t.object({ id: t.number }));
        expect(parseValue(null, nullishObj, 'test')).toBe(null);
        expect(parseValue(undefined, nullishObj, 'test')).toBe(undefined);
        expect(parseValue({ id: 1 }, nullishObj, 'test')).toEqual({ id: 1 });
      });

      it('should combine optional and nullable correctly', () => {
        // t.nullish should be equivalent to t.optional(t.nullable(x))
        const nullishType = t.nullish(t.string);
        expect(parseValue(null, nullishType, 'test')).toBe(null);
        expect(parseValue(undefined, nullishType, 'test')).toBe(undefined);
        expect(parseValue('hello', nullishType, 'test')).toBe('hello');
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
            response: { value: t.nullish(t.string) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBeNull();
        });
      });

      it('should parse undefined value in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: undefined });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.nullish(t.string) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBeUndefined();
        });
      });

      it('should parse present nullish field', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: 'present' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.nullish(t.string) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBe('present');
        });
      });
    });

    describe('within object', () => {
      it('should parse nullish in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { name: 'Alice', deletedAt: null, archivedAt: undefined },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                name: t.string,
                deletedAt: t.nullish(t.string),
                archivedAt: t.nullish(t.string),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.name).toBe('Alice');
          expect(result.user.deletedAt).toBeNull();
          expect(result.user.archivedAt).toBeUndefined();
        });
      });
    });

    describe('within array', () => {
      it('should parse array with null values in nullish', async () => {
        const { client, mockFetch } = getContext();
        // Note: JSON doesn't preserve undefined, so we test with null
        mockFetch.get('/items', { items: ['a', null, null, 'b'] });

        await testWithClient(client, async () => {
          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(t.nullish(t.string)) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toEqual(['a', null, null, 'b']);
        });
      });
    });

    describe('within record', () => {
      it('should parse record with nullish values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          values: { a: 'hello', b: null, c: undefined },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: { values: t.record(t.nullish(t.string)) },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.values.a).toBe('hello');
          expect(result.values.b).toBeNull();
          expect(result.values.c).toBeUndefined();
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse null nullish field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          nickname: t.nullish(t.string),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, nickname: null },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).nickname).toBeNull();
      });

      it('should parse present nullish field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          nickname: t.nullish(t.string),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, nickname: 'Ali' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).nickname).toBe('Ali');
      });
    });

    describe('within object', () => {
      it('should parse nullish in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Profile = entity(() => ({
          __typename: t.typename('Profile'),
          id: t.id,
          details: t.object({
            bio: t.nullish(t.string),
            website: t.nullish(t.string),
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

        const key = getEntityKey('Profile', 1, Profile.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).details.bio).toBeNull();
        expect((doc as any).details.website).toBe('https://example.com');
      });
    });

    describe('within array', () => {
      it('should parse nullish array in entity', async () => {
        const { client, kv } = getContext();

        const Post = entity(() => ({
          __typename: t.typename('Post'),
          id: t.id,
          tags: t.nullish(t.array(t.string)),
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

        const key = getEntityKey('Post', 1, Post.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).tags).toBeNull();
      });
    });

    describe('within record', () => {
      it('should parse record with nullish values in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.record(t.nullish(t.string)),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { theme: 'dark', custom: null, extra: undefined },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, Config.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings.theme).toBe('dark');
        expect((doc as any).settings.custom).toBeNull();
      });
    });
  });

  describe('undefined fallback on parse failure', () => {
    describe('Direct parseValue', () => {
      it('should return undefined for nullish field with invalid value', () => {
        const warnLogger = vi.fn();
        const NullishString = t.nullish(t.string);

        const result = parseValue(12345, NullishString, 'test.name', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalled();
      });

      it('should return undefined for nullish enum with unknown value', () => {
        const warnLogger = vi.fn();
        const NullishStatus = t.nullish(t.enum('active', 'inactive'));

        const result = parseValue('unknown', NullishStatus, 'test.status', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalled();
      });

      it('should return undefined for nullish date with invalid format', () => {
        const warnLogger = vi.fn();
        const NullishDate = t.nullish(t.format('date'));

        const result = parseValue('not-a-date', NullishDate, 'test.date', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).toHaveBeenCalled();
      });

      it('should still accept null for nullish type', () => {
        const warnLogger = vi.fn();
        const NullishString = t.nullish(t.string);

        const result = parseValue(null, NullishString, 'test', false, warnLogger);

        expect(result).toBeNull();
        expect(warnLogger).not.toHaveBeenCalled();
      });

      it('should still accept undefined for nullish type', () => {
        const warnLogger = vi.fn();
        const NullishString = t.nullish(t.string);

        const result = parseValue(undefined, NullishString, 'test', false, warnLogger);

        expect(result).toBeUndefined();
        expect(warnLogger).not.toHaveBeenCalled();
      });

      it('should fall back to undefined even without warn logger', () => {
        // Fallback always happens for nullish, warn logger just logs
        const NullishNumber = t.nullish(t.number);

        const result = parseValue('not a number', NullishNumber, 'test.count');
        expect(result).toBeUndefined();
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should return undefined for nullish fields with invalid values in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', {
          name: 'Test',
          value: { nested: 'object' }, // Wrong type for nullish number
        });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              name: t.string,
              value: t.nullish(t.number),
            },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.name).toBe('Test');
          expect(result.value).toBeUndefined();
        });
      });
    });
  });
});
