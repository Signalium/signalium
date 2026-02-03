import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.object Tests
 *
 * Tests for object type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.object', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse objects with primitive fields', () => {
        const personType = t.object({
          name: t.string,
          age: t.number,
          active: t.boolean,
        });
        const value = { name: 'Alice', age: 30, active: true };
        const result = parseValue(value, personType, 'test') as typeof value;

        expect(result.name).toBe('Alice');
        expect(result.age).toBe(30);
        expect(result.active).toBe(true);
      });

      it('should throw for non-object values', () => {
        const objType = t.object({ name: t.string });
        expect(() => parseValue('not object', objType, 'test')).toThrow('expected object, got string');
        expect(() => parseValue(42, objType, 'test')).toThrow('expected object, got number');
        expect(() => parseValue([], objType, 'test')).toThrow('expected object, got array');
        expect(() => parseValue(null, objType, 'test')).toThrow('expected object, got null');
      });

      it('should throw for missing required fields', () => {
        const personType = t.object({
          name: t.string,
          age: t.number,
        });
        expect(() => parseValue({ name: 'Alice' }, personType, 'test')).toThrow('expected number, got undefined');
      });
    });

    describe('nested objects', () => {
      it('should parse nested objects', () => {
        const addressType = t.object({
          city: t.string,
          country: t.string,
        });
        const personType = t.object({
          name: t.string,
          address: addressType,
        });
        const value = {
          name: 'Alice',
          address: { city: 'New York', country: 'USA' },
        };
        const result = parseValue(value, personType, 'test') as typeof value;

        expect(result.name).toBe('Alice');
        expect(result.address.city).toBe('New York');
        expect(result.address.country).toBe('USA');
      });

      it('should parse deeply nested objects', () => {
        const deepType = t.object({
          level1: t.object({
            level2: t.object({
              level3: t.object({
                value: t.string,
              }),
            }),
          }),
        });

        const value = { level1: { level2: { level3: { value: 'deep' } } } };
        const result = parseValue(value, deepType, 'test') as typeof value;

        expect(result.level1.level2.level3.value).toBe('deep');
      });
    });

    describe('within array', () => {
      it('should parse array of objects', () => {
        const itemType = t.object({ id: t.number, name: t.string });
        const result = parseValue(
          [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
          ],
          t.array(itemType),
          'test',
        ) as Array<{ id: number; name: string }>;

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[1].name).toBe('b');
      });
    });

    describe('within record', () => {
      it('should parse record of objects', () => {
        const itemType = t.object({ id: t.number, name: t.string });
        const result = parseValue(
          { item1: { id: 1, name: 'a' }, item2: { id: 2, name: 'b' } },
          t.record(itemType),
          'test',
        ) as Record<string, { id: number; name: string }>;

        expect(result.item1.id).toBe(1);
        expect(result.item2.name).toBe('b');
      });
    });

    describe('within union', () => {
      it('should parse object in union with primitive', () => {
        const objType = t.object({ value: t.number });
        const unionType = t.union(t.string, objType);

        expect(parseValue('hello', unionType, 'test')).toBe('hello');

        const objResult = parseValue({ value: 42 }, unionType, 'test') as { value: number };
        expect(objResult.value).toBe(42);
      });
    });

    describe('edge cases', () => {
      it('should handle objects with extra fields', () => {
        const objType = t.object({ name: t.string });
        const result = parseValue({ name: 'Alice', extra: 'ignored' }, objType, 'test') as any;

        expect(result.name).toBe('Alice');
        // Extra fields should be preserved
      });

      it('should show correct error path for nested field', () => {
        const objType = t.object({
          user: t.object({
            profile: t.object({
              age: t.number,
            }),
          }),
        });

        expect(() => parseValue({ user: { profile: { age: 'not number' } } }, objType, 'GET:/data')).toThrow(
          'Validation error at GET:/data.user.profile.age: expected number, got string',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse object in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', { user: { name: 'Alice', age: 30 } });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({ name: t.string, age: t.number }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.name).toBe('Alice');
          expect(result.user.age).toBe(30);
        });
      });
    });

    describe('nested objects', () => {
      it('should parse deeply nested objects in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/deep', {
          level1: {
            level2: {
              level3: { value: 'deep' },
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
                    value: t.string,
                  }),
                }),
              }),
            },
          }));

          const relay = getDeep();
          const result = await relay;

          expect(result.level1.level2.level3.value).toBe('deep');
        });
      });
    });

    describe('complex objects', () => {
      it('should parse object with multiple field types', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/complex', {
          data: {
            id: 1,
            name: 'Test',
            active: true,
            tags: ['a', 'b'],
            metadata: { key: 'value' },
          },
        });

        await testWithClient(client, async () => {
          const getComplex = query(() => ({
            path: '/complex',
            response: {
              data: t.object({
                id: t.number,
                name: t.string,
                active: t.boolean,
                tags: t.array(t.string),
                metadata: t.record(t.string),
              }),
            },
          }));

          const relay = getComplex();
          const result = await relay;

          expect(result.data.id).toBe(1);
          expect(result.data.name).toBe('Test');
          expect(result.data.active).toBe(true);
          expect(result.data.tags).toEqual(['a', 'b']);
          expect(result.data.metadata.key).toBe('value');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of objects in query', async () => {
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
          expect(result.items[0].id).toBe(1);
          expect(result.items[1].name).toBe('Item 2');
        });
      });
    });

    describe('within record', () => {
      it('should parse record of objects in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/users/map', {
          users: {
            alice: { id: 1, name: 'Alice' },
            bob: { id: 2, name: 'Bob' },
          },
        });

        await testWithClient(client, async () => {
          const getUserMap = query(() => ({
            path: '/users/map',
            response: {
              users: t.record(t.object({ id: t.number, name: t.string })),
            },
          }));

          const relay = getUserMap();
          const result = await relay;

          expect(result.users.alice.id).toBe(1);
          expect(result.users.bob.name).toBe('Bob');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse object field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          profile: t.object({
            bio: t.string,
            website: t.string,
          }),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: {
            __typename: 'User',
            id: 1,
            profile: { bio: 'Hello', website: 'example.com' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).profile.bio).toBe('Hello');
        expect((doc as any).profile.website).toBe('example.com');
      });
    });

    describe('nested entities', () => {
      it('should track refs for entity within object field', async () => {
        const { client, kv } = getContext();

        const Address = entity(() => ({
          __typename: t.typename('Address'),
          id: t.id,
          city: t.string,
        }));

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          address: Address,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            address: { __typename: 'Address', id: 100, city: 'NYC' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const userKey = getEntityKey('User', 1, User.shapeKey);
        const addressKey = getEntityKey('Address', 100, Address.shapeKey);

        const userRefs = await getEntityRefs(kv, userKey);
        expect(userRefs).toBeDefined();
        expect(userRefs).toContain(addressKey);
      });

      it('should track refs for sibling entities', async () => {
        const { client, kv } = getContext();

        const EntityB = entity(() => ({
          __typename: t.typename('EntityB'),
          id: t.id,
          name: t.string,
        }));

        const EntityC = entity(() => ({
          __typename: t.typename('EntityC'),
          id: t.id,
          name: t.string,
        }));

        const EntityA = entity(() => ({
          __typename: t.typename('EntityA'),
          id: t.id,
          name: t.string,
          b: EntityB,
          c: EntityC,
        }));

        const QueryResult = t.object({ data: EntityA });

        const result = {
          data: {
            __typename: 'EntityA',
            id: 1,
            name: 'A',
            b: { __typename: 'EntityB', id: 2, name: 'B' },
            c: { __typename: 'EntityC', id: 3, name: 'C' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(1);

        const keyA = getEntityKey('EntityA', 1, EntityA.shapeKey);
        const keyB = getEntityKey('EntityB', 2, EntityB.shapeKey);
        const keyC = getEntityKey('EntityC', 3, EntityC.shapeKey);

        // EntityA should reference both B and C
        const refsA = await getEntityRefs(kv, keyA);
        expect(refsA).toBeDefined();
        expect(refsA).toContain(keyB);
        expect(refsA).toContain(keyC);
        expect(refsA?.length).toBe(2);
      });
    });

    describe('within array', () => {
      it('should parse object array in entity', async () => {
        const { client, kv } = getContext();

        const Post = entity(() => ({
          __typename: t.typename('Post'),
          id: t.id,
          comments: t.array(
            t.object({
              author: t.string,
              text: t.string,
            }),
          ),
        }));

        const QueryResult = t.object({ post: Post });

        const result = {
          post: {
            __typename: 'Post',
            id: 1,
            comments: [
              { author: 'Alice', text: 'Great!' },
              { author: 'Bob', text: 'Thanks!' },
            ],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Post', 1, Post.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).comments).toHaveLength(2);
        expect((doc as any).comments[0].author).toBe('Alice');
      });
    });

    describe('within record', () => {
      it('should parse object record in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.record(
            t.object({
              enabled: t.boolean,
              value: t.string,
            }),
          ),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: {
              feature1: { enabled: true, value: 'on' },
              feature2: { enabled: false, value: 'off' },
            },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, Config.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings.feature1.enabled).toBe(true);
        expect((doc as any).settings.feature2.value).toBe('off');
      });
    });
  });
});
