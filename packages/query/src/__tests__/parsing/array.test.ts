import { describe, it, expect, vi } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.array Tests
 *
 * Tests for array type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.array', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse arrays of primitives', () => {
        expect(parseValue([1, 2, 3], t.array(t.number), 'test')).toEqual([1, 2, 3]);
        expect(parseValue(['a', 'b', 'c'], t.array(t.string), 'test')).toEqual(['a', 'b', 'c']);
        expect(parseValue([true, false], t.array(t.boolean), 'test')).toEqual([true, false]);
      });

      it('should parse empty arrays', () => {
        expect(parseValue([], t.array(t.number), 'test')).toEqual([]);
        expect(parseValue([], t.array(t.string), 'test')).toEqual([]);
      });

      it('should throw for non-array values', () => {
        expect(() => parseValue('not array', t.array(t.number), 'test')).toThrow('expected array, got string');
        expect(() => parseValue(42, t.array(t.number), 'test')).toThrow('expected array, got number');
        expect(() => parseValue({}, t.array(t.number), 'test')).toThrow('expected array, got object');
        expect(() => parseValue(null, t.array(t.number), 'test')).toThrow('expected array, got null');
      });

      it('should filter invalid items with warning callback', () => {
        const result = parseValue([1, 'invalid', 3], t.array(t.number), 'test', false, () => {});
        expect(result).toEqual([1, 3]);
      });
    });

    describe('within object', () => {
      it('should parse array fields in objects', () => {
        const objType = t.object({ tags: t.array(t.string), scores: t.array(t.number) });
        const result = parseValue({ tags: ['a', 'b'], scores: [1, 2, 3] }, objType, 'test') as any;

        expect(result.tags).toEqual(['a', 'b']);
        expect(result.scores).toEqual([1, 2, 3]);
      });
    });

    describe('nested arrays', () => {
      it('should parse nested arrays', () => {
        const result = parseValue(
          [
            [1, 2],
            [3, 4],
          ],
          t.array(t.array(t.number)),
          'test',
        );
        expect(result).toEqual([
          [1, 2],
          [3, 4],
        ]);
      });

      it('should parse deeply nested arrays', () => {
        const result = parseValue([[[1, 2]]], t.array(t.array(t.array(t.number))), 'test');
        expect(result).toEqual([[[1, 2]]]);
      });
    });

    describe('arrays of objects', () => {
      it('should parse arrays of objects', () => {
        const itemType = t.object({ id: t.number, name: t.string });
        const value = [
          { id: 1, name: 'item1' },
          { id: 2, name: 'item2' },
        ];
        const result = parseValue(value, t.array(itemType), 'test') as typeof value;

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[1].name).toBe('item2');
      });
    });

    describe('within record', () => {
      it('should parse record of arrays', () => {
        const result = parseValue(
          { nums: [1, 2, 3], strs: ['a', 'b'] },
          t.record(t.array(t.union(t.number, t.string))),
          'test',
        );
        expect(result).toEqual({ nums: [1, 2, 3], strs: ['a', 'b'] });
      });
    });

    describe('within union', () => {
      it('should parse array in union', () => {
        const unionType = t.union(t.array(t.number), t.string);
        expect(parseValue([1, 2, 3], unionType, 'test')).toEqual([1, 2, 3]);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });

    describe('edge cases', () => {
      it('should handle large arrays', () => {
        const largeArray = Array.from({ length: 10000 }, (_, i) => i);
        const result = parseValue(largeArray, t.array(t.number), 'test') as number[];
        expect(result).toHaveLength(10000);
        expect(result[0]).toBe(0);
        expect(result[9999]).toBe(9999);
      });

      it('should handle arrays with null items', () => {
        const result = parseValue([1, null, 3], t.array(t.nullable(t.number)), 'test');
        expect(result).toEqual([1, null, 3]);
      });

      it('should filter invalid items in array', () => {
        const result = parseValue([1, 'invalid', 3], t.array(t.number), 'test', false, () => {});
        expect(result).toEqual([1, 3]);
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse array in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: [1, 2, 3, 4, 5] });

        await testWithClient(client, async () => {
          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(t.number) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toEqual([1, 2, 3, 4, 5]);
        });
      });

      it('should handle empty arrays', async () => {
        const { client, mockFetch } = getContext();
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
    });

    describe('within object', () => {
      it('should parse arrays in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { profile: { skills: ['js', 'ts', 'python'] } },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                profile: t.object({
                  skills: t.array(t.string),
                }),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.profile.skills).toEqual(['js', 'ts', 'python']);
        });
      });
    });

    describe('nested arrays', () => {
      it('should parse nested arrays in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/matrix', {
          matrix: [
            [1, 2, 3],
            [4, 5, 6],
          ],
        });

        await testWithClient(client, async () => {
          const getMatrix = query(() => ({
            path: '/matrix',
            response: { matrix: t.array(t.array(t.number)) },
          }));

          const relay = getMatrix();
          const result = await relay;

          expect(result.matrix).toEqual([
            [1, 2, 3],
            [4, 5, 6],
          ]);
        });
      });
    });

    describe('arrays of objects', () => {
      it('should parse arrays of objects in query', async () => {
        const { client, mockFetch } = getContext();
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
    });

    describe('within record', () => {
      it('should parse record of arrays in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/tags', {
          tagsByCategory: {
            tech: ['javascript', 'typescript'],
            design: ['ui', 'ux'],
          },
        });

        await testWithClient(client, async () => {
          const getTags = query(() => ({
            path: '/tags',
            response: { tagsByCategory: t.record(t.array(t.string)) },
          }));

          const relay = getTags();
          const result = await relay;

          expect(result.tagsByCategory.tech).toEqual(['javascript', 'typescript']);
          expect(result.tagsByCategory.design).toEqual(['ui', 'ux']);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse array field in entity', async () => {
        const { client, kv } = getContext();

        const Post = entity(() => ({
          __typename: t.typename('Post'),
          id: t.id,
          tags: t.array(t.string),
        }));

        const QueryResult = t.object({ post: Post });

        const result = {
          post: { __typename: 'Post', id: 1, tags: ['tech', 'coding'] },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Post', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).tags).toEqual(['tech', 'coding']);
      });
    });

    describe('arrays of entities', () => {
      it('should parse array of entities', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ items: t.array(Item) });

        const result = {
          items: [
            { __typename: 'Item', id: 1, name: 'Item1' },
            { __typename: 'Item', id: 2, name: 'Item2' },
            { __typename: 'Item', id: 3, name: 'Item3' },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        // Array pushes entity refs up
        expect(entityRefs.size).toBe(3);

        const key1 = getEntityKey('Item', 1);
        const key2 = getEntityKey('Item', 2);
        const key3 = getEntityKey('Item', 3);

        expect(await getDocument(kv, key1)).toBeDefined();
        expect(await getDocument(kv, key2)).toBeDefined();
        expect(await getDocument(kv, key3)).toBeDefined();
      });

      it('should track refs for nested entities in arrays', async () => {
        const { client, kv } = getContext();

        const Child = entity(() => ({
          __typename: t.typename('Child'),
          id: t.id,
          name: t.string,
        }));

        const Parent = entity(() => ({
          __typename: t.typename('Parent'),
          id: t.id,
          name: t.string,
          child: Child,
        }));

        const QueryResult = t.object({ items: t.array(Parent) });

        const result = {
          items: [
            {
              __typename: 'Parent',
              id: 1,
              name: 'Parent1',
              child: { __typename: 'Child', id: 10, name: 'Child10' },
            },
            {
              __typename: 'Parent',
              id: 2,
              name: 'Parent2',
              child: { __typename: 'Child', id: 20, name: 'Child20' },
            },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2); // Parent entities

        const keyP1 = getEntityKey('Parent', 1);
        const keyP2 = getEntityKey('Parent', 2);
        const keyC10 = getEntityKey('Child', 10);
        const keyC20 = getEntityKey('Child', 20);

        // Parents should reference their children
        const refsP1 = await getEntityRefs(kv, keyP1);
        expect(refsP1).toBeDefined();
        expect(refsP1).toContain(keyC10);

        const refsP2 = await getEntityRefs(kv, keyP2);
        expect(refsP2).toBeDefined();
        expect(refsP2).toContain(keyC20);
      });
    });

    describe('within object', () => {
      it('should parse array in nested object within entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          profile: t.object({
            skills: t.array(t.string),
          }),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: {
            __typename: 'User',
            id: 1,
            profile: { skills: ['js', 'ts'] },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).profile.skills).toEqual(['js', 'ts']);
      });
    });

    describe('within record', () => {
      it('should parse record of arrays in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          groups: t.record(t.array(t.string)),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            groups: { admins: ['alice', 'bob'], users: ['charlie'] },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).groups).toEqual({ admins: ['alice', 'bob'], users: ['charlie'] });
      });
    });

    describe('within union', () => {
      it('should parse array in union field of entity', async () => {
        const { client, kv } = getContext();

        const Container = entity(() => ({
          __typename: t.typename('Container'),
          id: t.id,
          value: t.union(t.array(t.string), t.string),
        }));

        const QueryResult = t.object({ container: Container });

        const result = {
          container: {
            __typename: 'Container',
            id: 1,
            value: ['a', 'b', 'c'],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Container', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toEqual(['a', 'b', 'c']);
      });
    });
  });

  describe('parse failure filtering', () => {
    describe('Direct parseValue', () => {
      it('should filter out items with wrong primitive type', () => {
        const warnLogger = vi.fn();
        const result = parseValue([1, 2, 'not a number', 4, true, 6], t.array(t.number), 'test', false, warnLogger);

        expect(result).toEqual([1, 2, 4, 6]);
        expect(warnLogger).toHaveBeenCalled();
      });

      it('should filter out items with invalid enum value', () => {
        const warnLogger = vi.fn();
        const Status = t.enum('active', 'inactive', 'pending');
        const result = parseValue(
          ['active', 'unknown_status', 'inactive', 'new_status', 'pending'],
          t.array(Status),
          'test',
          false,
          warnLogger,
        );

        expect(result).toEqual(['active', 'inactive', 'pending']);
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });

      it('should filter out items with invalid date format', () => {
        const warnLogger = vi.fn();
        const result = parseValue(
          ['2024-01-15', 'not-a-date', '2024-06-20', 'invalid'],
          t.array(t.format('date')),
          'test',
          false,
          warnLogger,
        ) as Date[];

        expect(result).toHaveLength(2);
        expect(result![0]).toBeInstanceOf(Date);
        expect(result![1]).toBeInstanceOf(Date);
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });

      it('should handle nested arrays with filtering at each level', () => {
        const warnLogger = vi.fn();
        const result = parseValue(
          [
            [1, 2, 'bad', 4],
            ['all', 'bad', 'values'],
            [5, 6, 7],
          ],
          t.array(t.array(t.number)),
          'test',
          false,
          warnLogger,
        );

        expect(result).toEqual([[1, 2, 4], [], [5, 6, 7]]);
      });

      it('should return empty array when all items are filtered', () => {
        const warnLogger = vi.fn();
        const result = parseValue(['a', 'b', 'c'], t.array(t.number), 'test', false, warnLogger);

        expect(result).toEqual([]);
        expect(warnLogger).toHaveBeenCalledTimes(3);
      });

      it('should receive correct context in warn logger', () => {
        const warnLogger = vi.fn();
        parseValue([1, 'bad', 3], t.array(t.number), 'test.numbers', false, warnLogger);

        expect(warnLogger).toHaveBeenCalledWith(
          'Failed to parse array item, filtering out',
          expect.objectContaining({
            index: 1,
            value: 'bad',
            error: expect.any(String),
          }),
        );
      });

      it('should filter even without warn logger (warn logger is just for logging)', () => {
        // Filtering always happens for arrays, warn logger just logs
        const result = parseValue([1, 'bad', 3], t.array(t.number), 'test');
        expect(result).toEqual([1, 3]);
      });
    });

    describe('Query integration', () => {
      const getContext = setupParsingTests();

      it('should filter invalid items in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/numbers', { numbers: [1, 2, 'not a number', 4] });

        await testWithClient(client, async () => {
          const getNumbers = query(() => ({
            path: '/numbers',
            response: { numbers: t.array(t.number) },
          }));

          const relay = getNumbers();
          const result = await relay;

          expect(result.numbers).toEqual([1, 2, 4]);
        });
      });

      it('should filter entities with missing required ID', async () => {
        const { client, mockFetch } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        mockFetch.get('/users', {
          users: [
            { __typename: 'User', id: 1, name: 'Alice' },
            { __typename: 'User', name: 'Missing ID' },
            { __typename: 'User', id: 3, name: 'Charlie' },
          ],
        });

        await testWithClient(client, async () => {
          const getUsers = query(() => ({
            path: '/users',
            response: { users: t.array(User) },
          }));

          const relay = getUsers();
          const result = await relay;

          expect(result.users).toHaveLength(2);
          expect(result.users[0].name).toBe('Alice');
          expect(result.users[1].name).toBe('Charlie');
        });
      });

      it('should filter unknown typename in entity union array', async () => {
        const { client, mockFetch } = getContext();

        const TextPost = entity(() => ({
          __typename: t.typename('TextPost'),
          id: t.id,
          content: t.string,
        }));

        const ImagePost = entity(() => ({
          __typename: t.typename('ImagePost'),
          id: t.id,
          url: t.string,
        }));

        mockFetch.get('/posts', {
          posts: [
            { __typename: 'TextPost', id: '1', content: 'Hello' },
            { __typename: 'VideoPost', id: '2', videoUrl: '/video.mp4' }, // Unknown
            { __typename: 'ImagePost', id: '3', url: '/img.jpg' },
          ],
        });

        await testWithClient(client, async () => {
          const getPosts = query(() => ({
            path: '/posts',
            response: { posts: t.array(t.union(TextPost, ImagePost)) },
          }));

          const relay = getPosts();
          const result = await relay;

          expect(result.posts).toHaveLength(2);
          expect(result.posts[0].__typename).toBe('TextPost');
          expect(result.posts[1].__typename).toBe('ImagePost');
        });
      });
    });
  });
});
