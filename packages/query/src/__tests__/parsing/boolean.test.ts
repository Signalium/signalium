import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.boolean Tests
 *
 * Tests for boolean type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.boolean', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse valid booleans', () => {
        expect(parseValue(true, t.boolean, 'test')).toBe(true);
        expect(parseValue(false, t.boolean, 'test')).toBe(false);
      });

      it('should throw for non-boolean values', () => {
        expect(() => parseValue('true', t.boolean, 'test')).toThrow('expected boolean, got string');
        expect(() => parseValue(1, t.boolean, 'test')).toThrow('expected boolean, got number');
        expect(() => parseValue(0, t.boolean, 'test')).toThrow('expected boolean, got number');
        expect(() => parseValue(null, t.boolean, 'test')).toThrow('expected boolean, got null');
        expect(() => parseValue(undefined, t.boolean, 'test')).toThrow('expected boolean, got undefined');
        expect(() => parseValue({}, t.boolean, 'test')).toThrow('expected boolean, got object');
        expect(() => parseValue([], t.boolean, 'test')).toThrow('expected boolean, got array');
      });
    });

    describe('within object', () => {
      it('should parse boolean fields in objects', () => {
        const objType = t.object({ active: t.boolean, verified: t.boolean });
        const result = parseValue({ active: true, verified: false }, objType, 'test') as {
          active: boolean;
          verified: boolean;
        };

        expect(result.active).toBe(true);
        expect(result.verified).toBe(false);
      });

      it('should throw for invalid boolean field in object', () => {
        const objType = t.object({ active: t.boolean });

        expect(() => parseValue({ active: 'yes' }, objType, 'test')).toThrow('expected boolean, got string');
      });
    });

    describe('within array', () => {
      it('should parse array of booleans', () => {
        const result = parseValue([true, false, true], t.array(t.boolean), 'test');
        expect(result).toEqual([true, false, true]);
      });

      it('should parse empty boolean array', () => {
        const result = parseValue([], t.array(t.boolean), 'test');
        expect(result).toEqual([]);
      });

      it('should filter invalid items in array with warning callback', () => {
        const result = parseValue([true, 'invalid', false], t.array(t.boolean), 'test', false, () => {});
        expect(result).toEqual([true, false]);
      });
    });

    describe('within record', () => {
      it('should parse record of booleans', () => {
        const result = parseValue({ active: true, deleted: false }, t.record(t.boolean), 'test');
        expect(result).toEqual({ active: true, deleted: false });
      });

      it('should throw for invalid value in record', () => {
        expect(() => parseValue({ active: true, deleted: 'no' }, t.record(t.boolean), 'test')).toThrow(
          'expected boolean, got string',
        );
      });
    });

    describe('within union', () => {
      it('should parse boolean in union', () => {
        const unionType = t.union(t.string, t.boolean);
        expect(parseValue(true, unionType, 'test')).toBe(true);
        expect(parseValue(false, unionType, 'test')).toBe(false);
      });

      it('should throw for values not in union', () => {
        const unionType = t.union(t.string, t.boolean);
        expect(() => parseValue(42, unionType, 'test')).toThrow();
      });
    });

    describe('edge cases', () => {
      it('should not coerce truthy/falsy values', () => {
        expect(() => parseValue(1, t.boolean, 'test')).toThrow();
        expect(() => parseValue(0, t.boolean, 'test')).toThrow();
        expect(() => parseValue('', t.boolean, 'test')).toThrow();
        expect(() => parseValue('false', t.boolean, 'test')).toThrow();
      });

      it('should show correct error path', () => {
        expect(() => parseValue('true', t.boolean, 'GET:/user.active')).toThrow(
          'Validation error at GET:/user.active: expected boolean, got string',
        );
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse boolean in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { active: true, deleted: false });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { active: t.boolean, deleted: t.boolean },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.active).toBe(true);
          expect(result.deleted).toBe(false);
        });
      });
    });

    describe('within object', () => {
      it('should parse boolean in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { settings: { notifications: true, darkMode: false } },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                settings: t.object({
                  notifications: t.boolean,
                  darkMode: t.boolean,
                }),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.settings.notifications).toBe(true);
          expect(result.user.settings.darkMode).toBe(false);
        });
      });
    });

    describe('within array', () => {
      it('should parse array of booleans', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/flags', { flags: [true, false, true] });

        await testWithClient(client, async () => {
          const getFlags = query(() => ({
            path: '/flags',
            response: { flags: t.array(t.boolean) },
          }));

          const relay = getFlags();
          const result = await relay;

          expect(result.flags).toEqual([true, false, true]);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of booleans', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/permissions', {
          permissions: { read: true, write: false, delete: false },
        });

        await testWithClient(client, async () => {
          const getPermissions = query(() => ({
            path: '/permissions',
            response: { permissions: t.record(t.boolean) },
          }));

          const relay = getPermissions();
          const result = await relay;

          expect(result.permissions.read).toBe(true);
          expect(result.permissions.write).toBe(false);
          expect(result.permissions.delete).toBe(false);
        });
      });
    });

    describe('within union', () => {
      it('should parse boolean in union response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/value', { value: true });

        await testWithClient(client, async () => {
          const getValue = query(() => ({
            path: '/value',
            response: { value: t.union(t.string, t.boolean) },
          }));

          const relay = getValue();
          const result = await relay;

          expect(result.value).toBe(true);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse boolean field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          active: t.boolean,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, active: true },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).active).toBe(true);
      });
    });

    describe('within object', () => {
      it('should parse boolean in nested object within entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          settings: t.object({
            notifications: t.boolean,
            marketing: t.boolean,
          }),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: {
            __typename: 'User',
            id: 1,
            settings: { notifications: true, marketing: false },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings.notifications).toBe(true);
        expect((doc as any).settings.marketing).toBe(false);
      });
    });

    describe('within array', () => {
      it('should parse boolean array in entity', async () => {
        const { client, kv } = getContext();

        const Survey = entity(() => ({
          __typename: t.typename('Survey'),
          id: t.id,
          answers: t.array(t.boolean),
        }));

        const QueryResult = t.object({ survey: Survey });

        const result = {
          survey: {
            __typename: 'Survey',
            id: 1,
            answers: [true, false, true, true],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Survey', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).answers).toEqual([true, false, true, true]);
      });
    });

    describe('within record', () => {
      it('should parse boolean record in entity', async () => {
        const { client, kv } = getContext();

        const Role = entity(() => ({
          __typename: t.typename('Role'),
          id: t.id,
          permissions: t.record(t.boolean),
        }));

        const QueryResult = t.object({ role: Role });

        const result = {
          role: {
            __typename: 'Role',
            id: 1,
            permissions: { read: true, write: true, delete: false },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Role', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).permissions).toEqual({ read: true, write: true, delete: false });
      });
    });

    describe('within union', () => {
      it('should parse boolean in union field of entity', async () => {
        const { client, kv } = getContext();

        const Flag = entity(() => ({
          __typename: t.typename('Flag'),
          id: t.id,
          value: t.union(t.string, t.boolean),
        }));

        const QueryResult = t.object({ flag: Flag });

        const result = {
          flag: {
            __typename: 'Flag',
            id: 1,
            value: false,
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Flag', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toBe(false);
      });
    });
  });
});
