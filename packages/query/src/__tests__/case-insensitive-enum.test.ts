import { describe, it, expect, beforeEach } from 'vitest';
import { t, CaseInsensitiveSet } from '../typeDefs.js';
import { parseValue } from '../proxy.js';
import { typeToString } from '../errors.js';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient } from './utils.js';
import { CaseInsensitiveEnumSet } from 'src/types.js';

/**
 * Tests for t.enum.caseInsensitive() API
 *
 * Case-insensitive enums match string values case-insensitively during parsing,
 * but always return the canonical (originally defined) casing.
 */

describe('t.enum.caseInsensitive()', () => {
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
      // Numbers and booleans don't have case, so duplicates are just regular duplicates in a Set
      const enumSet = t.enum.caseInsensitive(1, 2, 3, true, false);
      expect(enumSet.size).toBe(5);
    });
  });

  describe('has() method', () => {
    it('should return true for exact matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending');

      expect(enumSet.has('Active')).toBe(true);
      expect(enumSet.has('Inactive')).toBe(true);
      expect(enumSet.has('Pending')).toBe(true);
    });

    it('should return true for case-insensitive string matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending') as CaseInsensitiveEnumSet<string>;

      expect(enumSet.has('active')).toBe(true);
      expect(enumSet.has('ACTIVE')).toBe(true);
      expect(enumSet.has('AcTiVe')).toBe(true);
      expect(enumSet.has('INACTIVE')).toBe(true);
      expect(enumSet.has('pending')).toBe(true);
    });

    it('should return false for non-matching values', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive') as CaseInsensitiveEnumSet<string>;

      expect(enumSet.has('Unknown')).toBe(false);
      expect(enumSet.has('')).toBe(false);
      expect(enumSet.has('Activ')).toBe(false);
    });

    it('should perform exact match for numbers', () => {
      const enumSet = t.enum.caseInsensitive(1, 2, 3) as CaseInsensitiveEnumSet<number>;

      expect(enumSet.has(1)).toBe(true);
      expect(enumSet.has(2)).toBe(true);
      expect(enumSet.has(4)).toBe(false);
    });

    it('should perform exact match for booleans', () => {
      const enumSet = t.enum.caseInsensitive(true, false) as CaseInsensitiveEnumSet<boolean>;

      expect(enumSet.has(true)).toBe(true);
      expect(enumSet.has(false)).toBe(true);
    });
  });

  describe('get() method', () => {
    it('should return canonical casing for string matches', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'INACTIVE', 'pending') as CaseInsensitiveEnumSet<string>;

      expect(enumSet.get('active')).toBe('Active');
      expect(enumSet.get('ACTIVE')).toBe('Active');
      expect(enumSet.get('inactive')).toBe('INACTIVE');
      expect(enumSet.get('PENDING')).toBe('pending');
    });

    it('should return undefined for non-matching strings', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive') as CaseInsensitiveEnumSet<string>;

      expect(enumSet.get('Unknown')).toBeUndefined();
      expect(enumSet.get('')).toBeUndefined();
    });

    it('should return the value for exact number matches', () => {
      const enumSet = t.enum.caseInsensitive(1, 2, 3) as CaseInsensitiveEnumSet<number>;

      expect(enumSet.get(1)).toBe(1);
      expect(enumSet.get(2)).toBe(2);
      expect(enumSet.get(4)).toBeUndefined();
    });

    it('should return the value for exact boolean matches', () => {
      const enumSet = t.enum.caseInsensitive(true) as CaseInsensitiveEnumSet<boolean>;

      expect(enumSet.get(true)).toBe(true);
      expect(enumSet.get(false)).toBeUndefined();
    });
  });

  describe('iteration', () => {
    it('should iterate over canonical values', () => {
      const enumSet = t.enum.caseInsensitive('Active', 'Inactive', 'Pending');
      const values = Array.from(enumSet);

      expect(values).toContain('Active');
      expect(values).toContain('Inactive');
      expect(values).toContain('Pending');
      expect(values).toHaveLength(3);
    });
  });

  describe('parseValue integration', () => {
    it('should parse exact match and return as-is', () => {
      const enumDef = t.enum.caseInsensitive('Active', 'Inactive', 'Pending');

      expect(parseValue('Active', enumDef, 'test.status')).toBe('Active');
      expect(parseValue('Inactive', enumDef, 'test.status')).toBe('Inactive');
    });

    it('should parse case-insensitive match and return canonical casing', () => {
      const enumDef = t.enum.caseInsensitive('Active', 'Inactive', 'Pending');

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

  describe('query integration', () => {
    let client: QueryClient;
    let mockFetch: ReturnType<typeof createMockFetch>;

    beforeEach(() => {
      client?.destroy();
      const store = new SyncQueryStore(new MemoryPersistentStore());
      mockFetch = createMockFetch();
      client = new QueryClient(store, { fetch: mockFetch as any });
    });

    it('should parse case-insensitive enum in query response', async () => {
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

    it('should work with nested objects', async () => {
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

    it('should work with arrays of case-insensitive enums', async () => {
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

    it('should reject invalid enum values', async () => {
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

  describe('comparison with regular enum', () => {
    it('should demonstrate the difference between enum and enumCaseInsensitive', () => {
      const regularEnum = t.enum('Active', 'Inactive');
      const caseInsensitiveEnum = t.enum.caseInsensitive('Active', 'Inactive');

      // Regular enum requires exact match
      expect(() => parseValue('active', regularEnum, 'test')).toThrow(/Validation error/);

      // Case-insensitive enum accepts different casing
      expect(parseValue('active', caseInsensitiveEnum, 'test')).toBe('Active');
    });
  });
});
