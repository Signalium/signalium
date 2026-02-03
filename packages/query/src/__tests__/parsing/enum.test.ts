import { describe, it, expect } from 'vitest';
import { t, entity, CaseInsensitiveSet } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { typeToString } from '../../errors.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.enum Tests
 *
 * Tests for enum type parsing (including case-insensitive) across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.enum', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse valid enum values', () => {
        const Status = t.enum('active', 'inactive', 'pending');
        expect(parseValue('active', Status, 'test')).toBe('active');
        expect(parseValue('inactive', Status, 'test')).toBe('inactive');
        expect(parseValue('pending', Status, 'test')).toBe('pending');
      });

      it('should throw for invalid enum values', () => {
        const Status = t.enum('active', 'inactive', 'pending');
        expect(() => parseValue('unknown', Status, 'test')).toThrow();
        expect(() => parseValue(42, Status, 'test')).toThrow();
      });

      it('should handle number enums', () => {
        const Priority = t.enum(1, 2, 3);
        expect(parseValue(1, Priority, 'test')).toBe(1);
        expect(parseValue(2, Priority, 'test')).toBe(2);
        expect(() => parseValue(4, Priority, 'test')).toThrow();
      });

      it('should handle boolean enums', () => {
        const BoolEnum = t.enum(true, false);
        expect(parseValue(true, BoolEnum, 'test')).toBe(true);
        expect(parseValue(false, BoolEnum, 'test')).toBe(false);
      });

      it('should handle mixed type enums', () => {
        const MixedEnum = t.enum('active', 42, true);
        expect(parseValue('active', MixedEnum, 'test')).toBe('active');
        expect(parseValue(42, MixedEnum, 'test')).toBe(42);
        expect(parseValue(true, MixedEnum, 'test')).toBe(true);
      });
    });

    describe('within object', () => {
      it('should parse enum fields in objects', () => {
        const Status = t.enum('active', 'inactive');
        const objType = t.object({ status: Status, priority: t.enum(1, 2, 3) });
        const result = parseValue({ status: 'active', priority: 2 }, objType, 'test') as {
          status: string;
          priority: number;
        };

        expect(result.status).toBe('active');
        expect(result.priority).toBe(2);
      });
    });

    describe('within array', () => {
      it('should parse array of enums', () => {
        const Status = t.enum('active', 'inactive');
        const result = parseValue(['active', 'inactive', 'active'], t.array(Status), 'test');
        expect(result).toEqual(['active', 'inactive', 'active']);
      });

      it('should filter invalid enum items in array', () => {
        const Status = t.enum('active', 'inactive');
        const result = parseValue(['active', 'unknown', 'inactive'], t.array(Status), 'test', false, () => {});
        expect(result).toEqual(['active', 'inactive']);
      });
    });

    describe('within record', () => {
      it('should parse record of enums', () => {
        const Status = t.enum('active', 'inactive');
        const result = parseValue({ user1: 'active', user2: 'inactive' }, t.record(Status), 'test');
        expect(result).toEqual({ user1: 'active', user2: 'inactive' });
      });
    });

    describe('within union', () => {
      it('should parse enum in union', () => {
        const Status = t.enum('active', 'inactive');
        const unionType = t.union(Status, t.number);
        expect(parseValue('active', unionType, 'test')).toBe('active');
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });
    });

    describe('edge cases', () => {
      it('should show descriptive error for invalid enum', () => {
        const Status = t.enum('active', 'inactive');
        expect(() => parseValue('unknown', Status, 'test.status')).toThrow(/Validation error/);
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse enum in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'active' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              status: t.enum('active', 'inactive', 'pending'),
            },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.status).toBe('active');
        });
      });
    });

    describe('within object', () => {
      it('should parse enum in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { settings: { theme: 'dark' } },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                settings: t.object({
                  theme: t.enum('light', 'dark', 'system'),
                }),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.settings.theme).toBe('dark');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of enums', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/statuses', { statuses: ['active', 'inactive', 'pending'] });

        await testWithClient(client, async () => {
          const getStatuses = query(() => ({
            path: '/statuses',
            response: { statuses: t.array(t.enum('active', 'inactive', 'pending')) },
          }));

          const relay = getStatuses();
          const result = await relay;

          expect(result.statuses).toEqual(['active', 'inactive', 'pending']);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of enums', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/users', {
          userStatuses: { alice: 'active', bob: 'inactive' },
        });

        await testWithClient(client, async () => {
          const getUsers = query(() => ({
            path: '/users',
            response: { userStatuses: t.record(t.enum('active', 'inactive')) },
          }));

          const relay = getUsers();
          const result = await relay;

          expect(result.userStatuses.alice).toBe('active');
          expect(result.userStatuses.bob).toBe('inactive');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse enum field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          status: t.enum('active', 'inactive', 'pending'),
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, status: 'active' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).status).toBe('active');
      });
    });

    describe('within array', () => {
      it('should parse enum array in entity', async () => {
        const { client, kv } = getContext();

        const Task = entity(() => ({
          __typename: t.typename('Task'),
          id: t.id,
          priorities: t.array(t.enum('low', 'medium', 'high')),
        }));

        const QueryResult = t.object({ task: Task });

        const result = {
          task: {
            __typename: 'Task',
            id: 1,
            priorities: ['high', 'medium', 'low'],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Task', 1, Task.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).priorities).toEqual(['high', 'medium', 'low']);
      });
    });
  });
});

describe('t.enum.caseInsensitive', () => {
  describe('CaseInsensitiveSet class', () => {
    it('should create a CaseInsensitiveSet with string values', () => {
      const enumSet = t.enum.caseInsensitive('yes', 'no', 'maybe');

      expect(enumSet).toBeInstanceOf(CaseInsensitiveSet);
      expect(enumSet.size).toBe(3);
    });

    it('should create a CaseInsensitiveSet with mixed value types', () => {
      const enumSet = t.enum.caseInsensitive('active', 42, true);

      expect(enumSet).toBeInstanceOf(CaseInsensitiveSet);
      expect(enumSet.size).toBe(3);
    });

    it('should throw when duplicate lowercase values are provided', () => {
      expect(() => t.enum.caseInsensitive('yes', 'YES')).toThrow(
        "Case-insensitive enum cannot have multiple values with the same lowercase form: 'yes' and 'YES' both become 'yes'",
      );

      expect(() => t.enum.caseInsensitive('Active', 'ACTIVE', 'active')).toThrow(/Case-insensitive enum cannot have/);
    });

    it('should allow same lowercase for non-string values', () => {
      const enumSet = t.enum.caseInsensitive(1, 2, 3, true, false);
      expect(enumSet.size).toBe(5);
    });
  });

  describe('has() method', () => {
    it('should return true for exact matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveSet<string>;

      expect(enumSet.has('Active')).toBe(true);
      expect(enumSet.has('Inactive')).toBe(true);
      expect(enumSet.has('Pending')).toBe(true);
    });

    it('should return true for case-insensitive string matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveSet<string>;

      expect(enumSet.has('active')).toBe(true);
      expect(enumSet.has('ACTIVE')).toBe(true);
      expect(enumSet.has('AcTiVe')).toBe(true);
      expect(enumSet.has('INACTIVE')).toBe(true);
      expect(enumSet.has('pending')).toBe(true);
    });

    it('should return false for non-matching values', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive') as CaseInsensitiveSet<string>;

      expect(enumSet.has('Unknown')).toBe(false);
      expect(enumSet.has('')).toBe(false);
      expect(enumSet.has('Activ')).toBe(false);
    });

    it('should perform exact match for numbers', () => {
      const enumSet = t.enum.caseInsensitive(1, 2, 3) as CaseInsensitiveSet<number>;

      expect(enumSet.has(1)).toBe(true);
      expect(enumSet.has(2)).toBe(true);
      expect(enumSet.has(4)).toBe(false);
    });

    it('should perform exact match for booleans', () => {
      const enumSet = t.enum.caseInsensitive(true, false);

      expect(enumSet.has(true)).toBe(true);
      expect(enumSet.has(false)).toBe(true);
    });
  });

  describe('get() method', () => {
    it('should return canonical casing for string matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'INACTIVE', 'pending') as CaseInsensitiveSet<string>;

      expect(enumSet.get('active')).toBe('Active');
      expect(enumSet.get('ACTIVE')).toBe('Active');
      expect(enumSet.get('inactive')).toBe('INACTIVE');
      expect(enumSet.get('PENDING')).toBe('pending');
    });

    it('should return undefined for non-matching strings', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive') as CaseInsensitiveSet<string>;

      expect(enumSet.get('Unknown')).toBeUndefined();
      expect(enumSet.get('')).toBeUndefined();
    });

    it('should return the value for exact number matches', () => {
      const enumSet = t.enum.caseInsensitive(1, 2, 3) as CaseInsensitiveSet<number>;

      expect(enumSet.get(1)).toBe(1);
      expect(enumSet.get(2)).toBe(2);
      expect(enumSet.get(4)).toBeUndefined();
    });

    it('should return the value for exact boolean matches', () => {
      const enumSet = t.enum.caseInsensitive(true) as CaseInsensitiveSet<boolean>;

      expect(enumSet.get(true)).toBe(true);
      expect(enumSet.get(false)).toBeUndefined();
    });
  });

  describe('iteration', () => {
    it('should iterate over canonical values', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveSet<string>;
      const values = Array.from(enumSet);

      expect(values).toContain('Active');
      expect(values).toContain('Inactive');
      expect(values).toContain('Pending');
      expect(values).toHaveLength(3);
    });
  });

  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse exact match and return as-is', () => {
        const enumDef = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveSet<string>;

        expect(parseValue('Active', enumDef, 'test.status')).toBe('Active');
        expect(parseValue('Inactive', enumDef, 'test.status')).toBe('Inactive');
      });

      it('should parse case-insensitive match and return canonical casing', () => {
        const enumDef = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveSet<string>;

        expect(parseValue('active', enumDef, 'test.status')).toBe('Active');
        expect(parseValue('ACTIVE', enumDef, 'test.status')).toBe('Active');
        expect(parseValue('INACTIVE', enumDef, 'test.status')).toBe('Inactive');
        expect(parseValue('pending', enumDef, 'test.status')).toBe('Pending');
      });

      it('should throw for non-matching values', () => {
        const enumDef = t.enum.caseInsensitive('Active', 'Inactive');

        expect(() => parseValue('Unknown', enumDef, 'test.status')).toThrow(
          'Validation error at test.status: expected "Active" | "Inactive", got string',
        );
      });

      it('should handle number values with exact match', () => {
        const enumDef = t.enum.caseInsensitive(1, 2, 3);

        expect(parseValue(1, enumDef, 'test.priority')).toBe(1);
        expect(parseValue(2, enumDef, 'test.priority')).toBe(2);
        expect(() => parseValue(4, enumDef, 'test.priority')).toThrow(/Validation error/);
      });

      it('should handle boolean values with exact match', () => {
        const enumDef = t.enum.caseInsensitive(true, false);

        expect(parseValue(true, enumDef, 'test.flag')).toBe(true);
        expect(parseValue(false, enumDef, 'test.flag')).toBe(false);
      });

      it('should handle mixed type enums', () => {
        const enumDef = t.enum.caseInsensitive('Active', 42, true);

        expect(parseValue('active', enumDef, 'test.value')).toBe('Active');
        expect(parseValue('ACTIVE', enumDef, 'test.value')).toBe('Active');
        expect(parseValue(42, enumDef, 'test.value')).toBe(42);
        expect(parseValue(true, enumDef, 'test.value')).toBe(true);
      });

      it('should demonstrate the difference between enum and enumCaseInsensitive', () => {
        const regularEnum = t.enum('Active', 'Inactive');
        const caseInsensitiveEnum = t.enum.caseInsensitive('Active', 'Inactive');

        // Regular enum requires exact match
        expect(() => parseValue('active', regularEnum, 'test')).toThrow(/Validation error/);

        // Case-insensitive enum accepts different casing
        expect(parseValue('active', caseInsensitiveEnum, 'test')).toBe('Active');
      });
    });

    describe('within object', () => {
      it('should parse case-insensitive enum in object', () => {
        const objType = t.object({ status: t.enum.caseInsensitive('Active', 'Inactive') });
        const result = parseValue({ status: 'ACTIVE' }, objType, 'test') as { status: string };

        expect(result.status).toBe('Active');
      });
    });

    describe('within array', () => {
      it('should parse and normalize case-insensitive enums in array', () => {
        const enumDef = t.enum.caseInsensitive('High', 'Medium', 'Low');
        const result = parseValue(['HIGH', 'medium', 'Low'], t.array(enumDef), 'test');
        expect(result).toEqual(['High', 'Medium', 'Low']);
      });
    });

    describe('within record', () => {
      it('should parse and normalize case-insensitive enums in record', () => {
        const enumDef = t.enum.caseInsensitive('Yes', 'No');
        const result = parseValue({ a: 'YES', b: 'no' }, t.record(enumDef), 'test');
        expect(result).toEqual({ a: 'Yes', b: 'No' });
      });
    });
  });

  describe('typeToString integration', () => {
    it('should format case-insensitive enum values correctly', () => {
      const enumDef = t.enum.caseInsensitive('Active', 'Inactive', 'Pending');
      const str = typeToString(enumDef);

      expect(str).toContain('"Active"');
      expect(str).toContain('"Inactive"');
      expect(str).toContain('"Pending"');
    });

    it('should format mixed type enum values correctly', () => {
      const enumDef = t.enum.caseInsensitive('Active', 42, true);
      const str = typeToString(enumDef);

      expect(str).toContain('"Active"');
      expect(str).toContain('42');
      expect(str).toContain('true');
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse case-insensitive enum in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'active' }); // lowercase from API

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              status: t.enum.caseInsensitive('Active', 'Inactive', 'Pending'),
            },
          }));

          const relay = getItem();
          const result = await relay;

          // Should be coerced to canonical casing
          expect(result.status).toBe('Active');
        });
      });

      it('should parse uppercase enum value to canonical casing', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'PENDING' }); // uppercase from API

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              status: t.enum.caseInsensitive('Active', 'Inactive', 'Pending'),
            },
          }));

          const relay = getItem();
          const result = await relay;

          // Should be coerced to canonical casing
          expect(result.status).toBe('Pending');
        });
      });
    });

    describe('within object', () => {
      it('should work with nested objects', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: {
            name: 'John',
            role: 'ADMIN', // uppercase from API
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: {
              user: t.object({
                name: t.string,
                role: t.enum.caseInsensitive('Admin', 'User', 'Guest'),
              }),
            },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.role).toBe('Admin');
        });
      });
    });

    describe('within array', () => {
      it('should work with arrays of case-insensitive enums', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/tags', {
          tags: ['HIGH', 'medium', 'Low'], // mixed casing from API
        });

        await testWithClient(client, async () => {
          const getTags = query(() => ({
            path: '/tags',
            response: {
              tags: t.array(t.enum.caseInsensitive('High', 'Medium', 'Low')),
            },
          }));

          const relay = getTags();
          const result = await relay;

          // All should be coerced to canonical casing
          expect(result.tags).toEqual(['High', 'Medium', 'Low']);
        });
      });
    });

    describe('error handling', () => {
      it('should reject invalid enum values', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'invalid' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: {
              status: t.enum.caseInsensitive('Active', 'Inactive'),
            },
          }));

          const relay = getItem();

          await expect(relay).rejects.toThrow(/Validation error/);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse case-insensitive enum in entity via query', async () => {
        const { client, mockFetch } = getContext();

        mockFetch.get('/user', {
          user: { __typename: 'User', id: 1, role: 'ADMIN' },
        });

        await testWithClient(client, async () => {
          const User = entity(() => ({
            __typename: t.typename('User'),
            id: t.id,
            role: t.enum.caseInsensitive('Admin', 'User', 'Guest'),
          }));

          const getUser = query(() => ({
            path: '/user',
            response: { user: User },
          }));

          const relay = getUser();
          const result = await relay;

          // Case-insensitive enum should normalize to canonical casing
          expect(result.user.role).toBe('Admin');
        });
      });
    });

    describe('within array', () => {
      it('should parse case-insensitive enums in entity array via query', async () => {
        const { client, mockFetch } = getContext();

        mockFetch.get('/task', {
          task: {
            __typename: 'Task',
            id: 1,
            tags: ['HIGH', 'medium', 'Low'],
          },
        });

        await testWithClient(client, async () => {
          const Task = entity(() => ({
            __typename: t.typename('Task'),
            id: t.id,
            tags: t.array(t.enum.caseInsensitive('High', 'Medium', 'Low')),
          }));

          const getTask = query(() => ({
            path: '/task',
            response: { task: Task },
          }));

          const relay = getTask();
          const result = await relay;

          // Case-insensitive enum should normalize to canonical casing
          expect(result.task.tags).toEqual(['High', 'Medium', 'Low']);
        });
      });
    });
  });
});
