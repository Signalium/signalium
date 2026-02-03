import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.record Tests
 *
 * Tests for record type (Record<string, T>) parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.record', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse record of strings', () => {
        const result = parseValue({ key1: 'value1', key2: 'value2' }, t.record(t.string), 'test');
        expect(result).toEqual({ key1: 'value1', key2: 'value2' });
      });

      it('should parse record of numbers', () => {
        const result = parseValue({ count: 42, price: 19.99 }, t.record(t.number), 'test');
        expect(result).toEqual({ count: 42, price: 19.99 });
      });

      it('should parse record of booleans', () => {
        const result = parseValue({ active: true, deleted: false }, t.record(t.boolean), 'test');
        expect(result).toEqual({ active: true, deleted: false });
      });

      it('should parse empty record', () => {
        const result = parseValue({}, t.record(t.string), 'test');
        expect(result).toEqual({});
        expect(Object.keys(result as object)).toHaveLength(0);
      });

      it('should throw for non-object values', () => {
        expect(() => parseValue('not object', t.record(t.string), 'test')).toThrow('expected object, got string');
        expect(() => parseValue([], t.record(t.string), 'test')).toThrow('expected object, got array');
        expect(() => parseValue(null, t.record(t.string), 'test')).toThrow('expected object, got null');
      });
    });

    describe('record of objects', () => {
      it('should parse record of objects', () => {
        const recordDef = t.record(t.object({ name: t.string, age: t.number }));
        const value = {
          user1: { name: 'Alice', age: 30 },
          user2: { name: 'Bob', age: 25 },
        };

        const result = parseValue(value, recordDef, 'test') as Record<string, { name: string; age: number }>;

        expect(result.user1.name).toBe('Alice');
        expect(result.user2.age).toBe(25);
      });
    });

    describe('record of arrays', () => {
      it('should parse record of arrays', () => {
        const recordDef = t.record(t.array(t.number));
        const value = { scores: [100, 95, 88], grades: [4, 3, 5] };

        const result = parseValue(value, recordDef, 'test') as Record<string, number[]>;

        expect(result.scores).toEqual([100, 95, 88]);
        expect(result.grades).toEqual([4, 3, 5]);
      });
    });

    describe('nested records', () => {
      it('should parse nested records', () => {
        const recordDef = t.record(t.record(t.number));
        const value = {
          category1: { item1: 10, item2: 20 },
          category2: { item3: 30, item4: 40 },
        };

        const result = parseValue(value, recordDef, 'test') as Record<string, Record<string, number>>;

        expect(result.category1.item1).toBe(10);
        expect(result.category2.item4).toBe(40);
      });
    });

    describe('within object', () => {
      it('should parse record within object', () => {
        const objType = t.object({
          name: t.string,
          metadata: t.record(t.string),
        });

        const result = parseValue({ name: 'Test', metadata: { key1: 'val1', key2: 'val2' } }, objType, 'test') as any;

        expect(result.name).toBe('Test');
        expect(result.metadata.key1).toBe('val1');
      });
    });

    describe('within array', () => {
      it('should parse array of records', () => {
        const result = parseValue(
          [
            { a: 1, b: 2 },
            { c: 3, d: 4 },
          ],
          t.array(t.record(t.number)),
          'test',
        );
        expect(result).toEqual([
          { a: 1, b: 2 },
          { c: 3, d: 4 },
        ]);
      });
    });

    describe('within union', () => {
      it('should parse record in union', () => {
        const unionType = t.union(t.record(t.number), t.string);
        expect(parseValue({ a: 1, b: 2 }, unionType, 'test')).toEqual({ a: 1, b: 2 });
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });

    describe('with formatted values', () => {
      it('should parse record of date-time formatted strings', () => {
        const recordDef = t.record(t.format('date-time'));
        const value = {
          created: '2024-01-15T10:30:00Z',
          updated: '2024-06-20T14:45:30Z',
        };

        const result = parseValue(value, recordDef, 'test') as Record<string, Date>;

        expect(result.created).toBeInstanceOf(Date);
        expect(result.updated).toBeInstanceOf(Date);
      });
    });

    describe('with optional/nullable values', () => {
      it('should parse record with optional values', () => {
        const recordDef = t.record(t.optional(t.string));
        const value = { present: 'value', missing: undefined };

        const result = parseValue(value, recordDef, 'test') as Record<string, string | undefined>;

        expect(result.present).toBe('value');
        expect(result.missing).toBeUndefined();
      });

      it('should parse record with nullable values', () => {
        const recordDef = t.record(t.nullable(t.number));
        const value = { count: 42, empty: null };

        const result = parseValue(value, recordDef, 'test') as Record<string, number | null>;

        expect(result.count).toBe(42);
        expect(result.empty).toBeNull();
      });
    });

    describe('validation errors', () => {
      it('should throw on invalid value type in record', () => {
        const recordDef = t.record(t.number);
        const value = { valid: 42, invalid: 'not a number' };

        expect(() => parseValue(value, recordDef, 'test')).toThrow(
          'Validation error at test["invalid"]: expected number, got string',
        );
      });

      it('should include record key in error path', () => {
        const recordDef = t.record(t.boolean);
        const value = { 'special-key': 'not a boolean' };

        expect(() => parseValue(value, recordDef, 'GET:/metadata')).toThrow(
          'Validation error at GET:/metadata["special-key"]: expected boolean, got string',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse record in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/config', {
          settings: { theme: 'dark', language: 'en', timezone: 'UTC' },
        });

        await testWithClient(client, async () => {
          const getConfig = query(() => ({
            path: '/config',
            response: { settings: t.record(t.string) },
          }));

          const relay = getConfig();
          const result = await relay;

          expect(result.settings.theme).toBe('dark');
          expect(result.settings.language).toBe('en');
        });
      });

      it('should handle empty record', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/empty', { data: {} });

        await testWithClient(client, async () => {
          const getEmpty = query(() => ({
            path: '/empty',
            response: { data: t.record(t.string) },
          }));

          const relay = getEmpty();
          const result = await relay;

          expect(result.data).toEqual({});
          expect(Object.keys(result.data)).toHaveLength(0);
        });
      });
    });

    describe('record of objects', () => {
      it('should parse record of objects in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/users/map', {
          users: {
            alice: { id: 1, name: 'Alice', active: true },
            bob: { id: 2, name: 'Bob', active: false },
          },
        });

        await testWithClient(client, async () => {
          const getUserMap = query(() => ({
            path: '/users/map',
            response: {
              users: t.record(t.object({ id: t.number, name: t.string, active: t.boolean })),
            },
          }));

          const relay = getUserMap();
          const result = await relay;

          expect(result.users.alice.id).toBe(1);
          expect(result.users.bob.active).toBe(false);
        });
      });
    });

    describe('nested records', () => {
      it('should parse nested records in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/permissions', {
          permissions: {
            admin: { read: true, write: true, delete: true },
            user: { read: true, write: false, delete: false },
          },
        });

        await testWithClient(client, async () => {
          const getPermissions = query(() => ({
            path: '/permissions',
            response: { permissions: t.record(t.record(t.boolean)) },
          }));

          const relay = getPermissions();
          const result = await relay;

          expect(result.permissions.admin.write).toBe(true);
          expect(result.permissions.user.delete).toBe(false);
        });
      });
    });

    describe('record of arrays', () => {
      it('should parse record of arrays in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/tags', {
          tagsByCategory: {
            tech: ['javascript', 'typescript', 'react'],
            design: ['ui', 'ux', 'figma'],
          },
        });

        await testWithClient(client, async () => {
          const getTags = query(() => ({
            path: '/tags',
            response: { tagsByCategory: t.record(t.array(t.string)) },
          }));

          const relay = getTags();
          const result = await relay;

          expect(result.tagsByCategory.tech).toEqual(['javascript', 'typescript', 'react']);
          expect(result.tagsByCategory.design).toEqual(['ui', 'ux', 'figma']);
        });
      });
    });

    describe('with formatted values', () => {
      it('should parse record with date-time formatted values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/timestamps', {
          events: {
            login: '2024-01-15T10:30:00Z',
            logout: '2024-01-15T18:45:30Z',
          },
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
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse record field in entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.record(t.string),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { theme: 'dark', locale: 'en' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, Config.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings).toEqual({ theme: 'dark', locale: 'en' });
      });
    });

    describe('record of entities', () => {
      it('should parse record of entities', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }));

        const QueryResult = t.object({ userMap: t.record(User) });

        const result = {
          userMap: {
            alice: { __typename: 'User', id: 1, name: 'Alice', email: 'alice@example.com' },
            bob: { __typename: 'User', id: 2, name: 'Bob', email: 'bob@example.com' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        // Records push entity refs up
        expect(entityRefs.size).toBe(2);

        const key1 = getEntityKey('User', 1, User.shapeKey);
        const key2 = getEntityKey('User', 2, User.shapeKey);

        expect(await getDocument(kv, key1)).toBeDefined();
        expect(await getDocument(kv, key2)).toBeDefined();
      });

      it('should track refs for entities in records', async () => {
        const { client, kv } = getContext();

        const EntityValue = entity(() => ({
          __typename: t.typename('EntityValue'),
          id: t.id,
          value: t.string,
        }));

        const QueryResult = t.object({ map: t.record(EntityValue) });

        const result = {
          map: {
            a: { __typename: 'EntityValue', id: 1, value: 'A' },
            b: { __typename: 'EntityValue', id: 2, value: 'B' },
            c: { __typename: 'EntityValue', id: 3, value: 'C' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(3);

        const key1 = getEntityKey('EntityValue', 1, EntityValue.shapeKey);
        const key2 = getEntityKey('EntityValue', 2, EntityValue.shapeKey);
        const key3 = getEntityKey('EntityValue', 3, EntityValue.shapeKey);

        expect(entityRefs.has(key1)).toBe(true);
        expect(entityRefs.has(key2)).toBe(true);
        expect(entityRefs.has(key3)).toBe(true);

        // Leaf entities should not have refs
        expect(await getEntityRefs(kv, key1)).toBeUndefined();
        expect(await getEntityRefs(kv, key2)).toBeUndefined();
        expect(await getEntityRefs(kv, key3)).toBeUndefined();
      });
    });

    describe('within object', () => {
      it('should parse record in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Profile = entity(() => ({
          __typename: t.typename('Profile'),
          id: t.id,
          social: t.object({
            links: t.record(t.string),
          }),
        }));

        const QueryResult = t.object({ profile: Profile });

        const result = {
          profile: {
            __typename: 'Profile',
            id: 1,
            social: { links: { twitter: '@user', github: 'user' } },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Profile', 1, Profile.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).social.links).toEqual({ twitter: '@user', github: 'user' });
      });
    });

    describe('within array', () => {
      it('should parse array of records in entity', async () => {
        const { client, kv } = getContext();

        const Container = entity(() => ({
          __typename: t.typename('Container'),
          id: t.id,
          items: t.array(t.record(t.number)),
        }));

        const QueryResult = t.object({ container: Container });

        const result = {
          container: {
            __typename: 'Container',
            id: 1,
            items: [
              { a: 1, b: 2 },
              { c: 3, d: 4 },
            ],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Container', 1, Container.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).items).toEqual([
          { a: 1, b: 2 },
          { c: 3, d: 4 },
        ]);
      });
    });

    describe('within union', () => {
      it('should parse record in union field of entity', async () => {
        const { client, kv } = getContext();

        const Flexible = entity(() => ({
          __typename: t.typename('Flexible'),
          id: t.id,
          data: t.union(t.record(t.string), t.array(t.string)),
        }));

        const QueryResult = t.object({ flexible: Flexible });

        const result = {
          flexible: {
            __typename: 'Flexible',
            id: 1,
            data: { key1: 'val1', key2: 'val2' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Flexible', 1, Flexible.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).data).toEqual({ key1: 'val1', key2: 'val2' });
      });
    });
  });
});
