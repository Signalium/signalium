import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
 * t.string Tests
 *
 * Tests for string type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.string', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse valid strings', () => {
        expect(parseValue('hello', t.string, 'test')).toBe('hello');
        expect(parseValue('', t.string, 'test')).toBe('');
        expect(parseValue('hello world', t.string, 'test')).toBe('hello world');
      });

      it('should parse strings with special characters', () => {
        expect(parseValue('hello\nworld', t.string, 'test')).toBe('hello\nworld');
        expect(parseValue('hello\tworld', t.string, 'test')).toBe('hello\tworld');
        expect(parseValue('emoji: 🎉', t.string, 'test')).toBe('emoji: 🎉');
      });

      it('should throw for non-string values', () => {
        expect(() => parseValue(42, t.string, 'test')).toThrow('expected string, got number');
        expect(() => parseValue(true, t.string, 'test')).toThrow('expected string, got boolean');
        expect(() => parseValue(null, t.string, 'test')).toThrow('expected string, got null');
        expect(() => parseValue(undefined, t.string, 'test')).toThrow('expected string, got undefined');
        expect(() => parseValue({}, t.string, 'test')).toThrow('expected string, got object');
        expect(() => parseValue([], t.string, 'test')).toThrow('expected string, got array');
      });
    });

    describe('within object', () => {
      it('should parse string fields in objects', () => {
        const objType = t.object({ name: t.string, label: t.string });
        const result = parseValue({ name: 'Alice', label: 'User' }, objType, 'test') as { name: string; label: string };

        expect(result.name).toBe('Alice');
        expect(result.label).toBe('User');
      });

      it('should throw for invalid string field in object', () => {
        const objType = t.object({ name: t.string });

        expect(() => parseValue({ name: 42 }, objType, 'test')).toThrow('expected string, got number');
      });
    });

    describe('within array', () => {
      it('should parse array of strings', () => {
        const result = parseValue(['a', 'b', 'c'], t.array(t.string), 'test');
        expect(result).toEqual(['a', 'b', 'c']);
      });

      it('should parse empty string array', () => {
        const result = parseValue([], t.array(t.string), 'test');
        expect(result).toEqual([]);
      });

      it('should filter invalid items in array with warning callback', () => {
        const result = parseValue([1, 'valid', 3], t.array(t.string), 'test', () => {});
        expect(result).toEqual(['valid']);
      });
    });

    describe('within record', () => {
      it('should parse record of strings', () => {
        const result = parseValue({ key1: 'val1', key2: 'val2' }, t.record(t.string), 'test');
        expect(result).toEqual({ key1: 'val1', key2: 'val2' });
      });

      it('should throw for invalid value in record', () => {
        expect(() => parseValue({ key1: 'valid', key2: 42 }, t.record(t.string), 'test')).toThrow(
          'expected string, got number',
        );
      });
    });

    describe('within union', () => {
      it('should parse string in union', () => {
        const unionType = t.union(t.string, t.number);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });

      it('should throw for values not in union', () => {
        const unionType = t.union(t.string, t.number);
        expect(() => parseValue(true, unionType, 'test')).toThrow();
      });
    });

    describe('edge cases', () => {
      it('should handle very long strings', () => {
        const longString = 'a'.repeat(10000);
        expect(parseValue(longString, t.string, 'test')).toBe(longString);
      });

      it('should handle unicode strings', () => {
        expect(parseValue('日本語', t.string, 'test')).toBe('日本語');
        expect(parseValue('العربية', t.string, 'test')).toBe('العربية');
      });

      it('should show correct error path', () => {
        expect(() => parseValue(42, t.string, 'GET:/user.profile.name')).toThrow(
          'Validation error at GET:/user.profile.name: expected string, got number',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse string in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { name: 'Test String' });

        await testWithClient(client, async () => {
          class GetItem extends RESTQuery {
            path = '/item';
            result = { name: t.string };
          }

          const relay = fetchQuery(GetItem);
          const result = await relay;

          expect(result.name).toBe('Test String');
          expect(typeof result.name).toBe('string');
        });
      });

      it('should handle empty string', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: '' });

        await testWithClient(client, async () => {
          class GetItem extends RESTQuery {
            path = '/item';
            result = { value: t.string };
          }

          const relay = fetchQuery(GetItem);
          const result = await relay;

          expect(result.value).toBe('');
        });
      });
    });

    describe('within object', () => {
      it('should parse string in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { profile: { bio: 'Hello world' } },
        });

        await testWithClient(client, async () => {
          class GetUser extends RESTQuery {
            path = '/user';
            result = {
              user: t.object({
                profile: t.object({
                  bio: t.string,
                }),
              }),
            };
          }

          const relay = fetchQuery(GetUser);
          const result = await relay;

          expect(result.user.profile.bio).toBe('Hello world');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of strings', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/tags', { tags: ['a', 'b', 'c'] });

        await testWithClient(client, async () => {
          class GetTags extends RESTQuery {
            path = '/tags';
            result = { tags: t.array(t.string) };
          }

          const relay = fetchQuery(GetTags);
          const result = await relay;

          expect(result.tags).toEqual(['a', 'b', 'c']);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of strings', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/config', {
          settings: { theme: 'dark', language: 'en' },
        });

        await testWithClient(client, async () => {
          class GetConfig extends RESTQuery {
            path = '/config';
            result = { settings: t.record(t.string) };
          }

          const relay = fetchQuery(GetConfig);
          const result = await relay;

          expect(result.settings.theme).toBe('dark');
          expect(result.settings.language).toBe('en');
        });
      });
    });

    describe('within union', () => {
      it('should parse string in union response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/value', { value: 'hello' });

        await testWithClient(client, async () => {
          class GetValue extends RESTQuery {
            path = '/value';
            result = { value: t.union(t.string, t.number) };
          }

          const relay = fetchQuery(GetValue);
          const result = await relay;

          expect(result.value).toBe('hello');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse string field in entity', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 1, name: 'Alice' },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).name).toBe('Alice');
      });
    });

    describe('within object', () => {
      it('should parse string in nested object within entity', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          profile = t.object({
            bio: t.string,
          });
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: {
            __typename: 'User',
            id: 1,
            profile: { bio: 'Hello world' },
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).profile.bio).toBe('Hello world');
      });
    });

    describe('within array', () => {
      it('should parse string array in entity', async () => {
        const { client, kv } = getContext();

        class Post extends Entity {
          __typename = t.typename('Post');
          id = t.id;
          tags = t.array(t.string);
        }

        const QueryResult = t.object({ post: t.entity(Post) });

        const result = {
          post: {
            __typename: 'Post',
            id: 1,
            tags: ['tech', 'coding'],
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Post', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).tags).toEqual(['tech', 'coding']);
      });
    });

    describe('within record', () => {
      it('should parse string record in entity', async () => {
        const { client, kv } = getContext();

        class Config extends Entity {
          __typename = t.typename('Config');
          id = t.id;
          settings = t.record(t.string);
        }

        const QueryResult = t.object({ config: t.entity(Config) });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { theme: 'dark', locale: 'en' },
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings).toEqual({ theme: 'dark', locale: 'en' });
      });
    });

    describe('within union', () => {
      it('should parse string in union field of entity', async () => {
        const { client, kv } = getContext();

        class Item extends Entity {
          __typename = t.typename('Item');
          id = t.id;
          value = t.union(t.string, t.number);
        }

        const QueryResult = t.object({ item: t.entity(Item) });

        const result = {
          item: {
            __typename: 'Item',
            id: 1,
            value: 'text value',
          },
        };

        const entityRefs = new Map();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Item', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toBe('text value');
      });
    });
  });
});
