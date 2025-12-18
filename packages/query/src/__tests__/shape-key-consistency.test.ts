import { describe, it, expect } from 'vitest';
import { t, entity, defineObject, defineArray, defineRecord } from '../typeDefs.js';
import { query, queryKeyForFn } from '../query.js';

/**
 * Test suite to verify that shapeKey is consistent and deterministic.
 *
 * Requirements:
 * 1. Same entity/query definitions should produce the same shapeKey across multiple calls
 * 2. Two identical entity definitions created separately should have the same shapeKey
 * 3. Different shapes should produce different shapeKeys
 * 4. Query keys (which include shapeKey) should be consistent for identical queries
 * 5. ShapeKey should be consistent across "reboots" (recreating definitions)
 */

describe('shapeKey consistency', () => {
  describe('Entity shapeKey consistency', () => {
    it('should produce the same shapeKey for the same entity definition across multiple accesses', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      // Access shapeKey multiple times
      const key1 = User.shapeKey;
      const key2 = User.shapeKey;
      const key3 = User.shapeKey;

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should produce the same shapeKey for identical entity definitions created separately', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      // Force shape reification
      expect(User1.shapeKey).toBeDefined();
      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce different shapeKeys for entities with different fields', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string, // Different field
      }));

      expect(User1.shapeKey).not.toBe(User2.shapeKey);
    });

    it('should produce different shapeKeys for entities with different field types', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        age: t.number,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        age: t.string, // Different type
      }));

      expect(User1.shapeKey).not.toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys regardless of field order', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        email: t.string, // Different order
        id: t.id,
        name: t.string,
      }));

      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys for nested entities', () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        street: t.string,
        city: t.string,
      }));

      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address,
      }));

      const Address2 = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        street: t.string,
        city: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address2,
      }));

      // Both Address entities should have the same shapeKey
      expect(Address.shapeKey).toBe(Address2.shapeKey);

      // Both User entities should have the same shapeKey
      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys for entities with arrays', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        tags: t.array(t.string),
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        tags: t.array(t.string),
      }));

      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys for entities with records', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        metadata: t.record(t.string),
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        metadata: t.record(t.string),
      }));

      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys for entities with enums', () => {
      const Status = t.enum('active', 'inactive', 'pending');

      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        status: Status,
      }));

      const Status2 = t.enum('active', 'inactive', 'pending');

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        status: Status2,
      }));

      expect(User1.shapeKey).toBe(User2.shapeKey);
    });

    it('should produce consistent shapeKeys for entities with case-insensitive enums', () => {
      const Status = t.enum.caseInsensitive('active', 'inactive', 'pending');

      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        status: Status,
      }));

      const Status2 = t.enum.caseInsensitive('active', 'inactive', 'pending');

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        status: Status2,
      }));

      expect(User1.shapeKey).toBe(User2.shapeKey);
    });
  });

  describe('Object shapeKey consistency', () => {
    it('should produce the same shapeKey for identical object definitions', () => {
      const Config1 = defineObject({
        apiKey: t.string,
        timeout: t.number,
      });

      const Config2 = defineObject({
        apiKey: t.string,
        timeout: t.number,
      });

      expect(Config1.shapeKey).toBe(Config2.shapeKey);
    });

    it('should produce different shapeKeys for objects with different fields', () => {
      const Config1 = defineObject({
        apiKey: t.string,
      });

      const Config2 = defineObject({
        apiKey: t.string,
        timeout: t.number,
      });

      expect(Config1.shapeKey).not.toBe(Config2.shapeKey);
    });
  });

  describe('Array shapeKey consistency', () => {
    it('should produce the same shapeKey for identical array definitions', () => {
      const StringArray1 = defineArray(t.string);
      const StringArray2 = defineArray(t.string);

      expect(StringArray1.shapeKey).toBe(StringArray2.shapeKey);
    });

    it('should produce different shapeKeys for arrays with different element types', () => {
      const StringArray = defineArray(t.string);
      const NumberArray = defineArray(t.number);

      expect(StringArray.shapeKey).not.toBe(NumberArray.shapeKey);
    });
  });

  describe('Record shapeKey consistency', () => {
    it('should produce the same shapeKey for identical record definitions', () => {
      const StringRecord1 = defineRecord(t.string);
      const StringRecord2 = defineRecord(t.string);

      expect(StringRecord1.shapeKey).toBe(StringRecord2.shapeKey);
    });

    it('should produce different shapeKeys for records with different value types', () => {
      const StringRecord = defineRecord(t.string);
      const NumberRecord = defineRecord(t.number);

      expect(StringRecord.shapeKey).not.toBe(NumberRecord.shapeKey);
    });
  });

  describe('Union shapeKey consistency', () => {
    it('should produce the same shapeKey for identical union definitions', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const Union1 = t.union(User, Post);
      const Union2 = t.union(User, Post);

      expect(Union1.shapeKey).toBe(Union2.shapeKey);
    });

    it('should produce different shapeKeys for unions with different members', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const Comment = entity(() => ({
        __typename: t.typename('Comment'),
        id: t.id,
        content: t.string,
      }));

      const Union1 = t.union(User, Post);
      const Union2 = t.union(User, Comment);

      expect(Union1.shapeKey).not.toBe(Union2.shapeKey);
    });
  });

  describe('Query shapeKey consistency', () => {
    it('should produce the same shapeKey for identical query definitions', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const query1 = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      const query2 = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      expect(queryKeyForFn(query1, { id: '123' })).toBe(queryKeyForFn(query2, { id: '123' }));
    });

    it('should produce the same shapeKey for queries with identical inline response shapes', () => {
      const query1 = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.id,
          name: t.string,
          email: t.string,
        },
      }));

      const query2 = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.id,
          name: t.string,
          email: t.string,
        },
      }));

      expect(queryKeyForFn(query1, { id: '123' })).toBe(queryKeyForFn(query2, { id: '123' }));
    });

    it('should produce different shapeKeys for queries with different response shapes', () => {
      // First, verify that the object shapes themselves have different shapeKeys
      const shape1 = t.object({
        id: t.id,
        name: t.string,
      });

      const shape2 = t.object({
        id: t.id,
        name: t.string,
        email: t.string, // Different field
      });

      // The object shapes should have different shapeKeys
      expect(shape1.shapeKey).not.toBe(shape2.shapeKey);

      // Now verify that queries using these shapes produce different query keys
      const query1 = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.id,
          name: t.string,
        },
      }));

      const query2 = query(() => ({
        path: '/users/[id]',
        response: {
          id: t.id,
          name: t.string,
          email: t.string, // Different field
        },
      }));

      const params = { id: '123' };
      const key1 = queryKeyForFn(query1, params);
      const key2 = queryKeyForFn(query2, params);

      expect(key1).not.toBe(key2);
    });

    it('should produce consistent query keys for identical queries', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const queryDef = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      const params = { id: '123' };

      // Query keys should be consistent
      const key1 = queryKeyForFn(queryDef, params);
      const key2 = queryKeyForFn(queryDef, params);
      const key3 = queryKeyForFn(queryDef, params);

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should produce the same query keys for identical queries created separately', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const query1 = query(() => ({
        path: '/users/[id]',
        response: User1,
      }));

      const query2 = query(() => ({
        path: '/users/[id]',
        response: User2,
      }));

      const params = { id: '123' };

      // Since User1 and User2 have the same shapeKey, query keys should match
      expect(User1.shapeKey).toBe(User2.shapeKey);
      expect(queryKeyForFn(query1, params)).toBe(queryKeyForFn(query2, params));
    });

    it('should produce different query keys for queries with different shapes but same params', () => {
      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string, // Different shape
      }));

      const query1 = query(() => ({
        path: '/users/[id]',
        response: User1,
      }));

      const query2 = query(() => ({
        path: '/users/[id]',
        response: User2,
      }));

      const params = { id: '123' };

      // Different shapes should produce different query keys
      // NOTE: This test verifies that shapeKey is properly included in query key computation
      expect(User1.shapeKey).not.toBe(User2.shapeKey);

      // Queries using different entity shapes should produce different query keys
      const key1 = queryKeyForFn(query1, params);
      const key2 = queryKeyForFn(query2, params);

      expect(key1).not.toBe(key2);
    });
  });

  describe('Extended entity shapeKey consistency', () => {
    it('should produce consistent shapeKeys for extended entities', () => {
      const BaseUser1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser1 = BaseUser1.extend(() => ({
        email: t.string,
      }));

      const BaseUser2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser2 = BaseUser2.extend(() => ({
        email: t.string,
      }));

      // Extended entities with the same base and same extensions should have the same shapeKey
      expect(ExtendedUser1.shapeKey).toBe(ExtendedUser2.shapeKey);
    });

    it('should produce different shapeKeys for entities extended differently', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser1 = BaseUser.extend(() => ({
        email: t.string,
      }));

      const ExtendedUser2 = BaseUser.extend(() => ({
        age: t.number, // Different extension
      }));

      expect(ExtendedUser1.shapeKey).not.toBe(ExtendedUser2.shapeKey);
    });
  });

  describe('Complex nested structures', () => {
    it('should produce consistent shapeKeys for deeply nested structures', () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        street: t.string,
        city: t.string,
      }));

      const Company = entity(() => ({
        __typename: t.typename('Company'),
        id: t.id,
        name: t.string,
      }));

      const User1 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address,
        company: Company,
        tags: t.array(t.string),
      }));

      const Address2 = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        street: t.string,
        city: t.string,
      }));

      const Company2 = entity(() => ({
        __typename: t.typename('Company'),
        id: t.id,
        name: t.string,
      }));

      const User2 = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address2,
        company: Company2,
        tags: t.array(t.string),
      }));

      expect(Address.shapeKey).toBe(Address2.shapeKey);
      expect(Company.shapeKey).toBe(Company2.shapeKey);
      expect(User1.shapeKey).toBe(User2.shapeKey);
    });
  });

  describe('Cross-reboot consistency simulation', () => {
    it('should produce the same shapeKeys when definitions are recreated in the same order', () => {
      // Simulate a "reboot" by creating definitions from scratch
      // This tests that shapeKey computation is purely based on the shape structure,
      // not on any runtime state or object identity

      function createUserEntity() {
        return entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }));
      }

      const User1 = createUserEntity();
      const User2 = createUserEntity();
      const User3 = createUserEntity();

      // All should have the same shapeKey
      expect(User1.shapeKey).toBe(User2.shapeKey);
      expect(User2.shapeKey).toBe(User3.shapeKey);
    });

    it('should produce consistent query keys across "reboots"', () => {
      function createQuery() {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        return query(() => ({
          path: '/users/[id]',
          response: User,
        }));
      }

      const query1 = createQuery();
      const query2 = createQuery();

      const params = { id: '123' };

      // Query keys should be the same even though the definitions were created separately
      expect(queryKeyForFn(query1, params)).toBe(queryKeyForFn(query2, params));
    });
  });
});
