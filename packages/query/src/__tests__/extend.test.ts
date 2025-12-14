import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import type { ExtractType } from '../types.js';
import { createMockFetch, getEntityMapSize, testWithClient } from './utils.js';

/**
 * Extend Method Tests
 *
 * Tests the extend() method on EntityDef and ObjectDef types.
 */

describe('extend() method', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('EntityDef.extend()', () => {
    it('should extend an entity with new fields', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
        age: t.number,
      }));

      // Verify the extended entity has all fields
      expect(ExtendedUser.shape).toBeDefined();
      expect(ExtendedUser.shape.__typename).toBe('User');
      expect(ExtendedUser.shape.id).toBeDefined();
      expect(ExtendedUser.shape.name).toBeDefined();
      expect(ExtendedUser.shape.email).toBeDefined();
      expect(ExtendedUser.shape.age).toBeDefined();
    });

    it('should preserve the original entity unchanged', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const _ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
      }));

      // Original should not have email field
      expect(BaseUser.shape).toBeDefined();
      expect(Object.keys(BaseUser.shape)).toEqual(['__typename', 'id', 'name']);
      expect((BaseUser.shape as any).email).toBeUndefined();
    });

    it('should work in queries with extended entities', async () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
        age: t.number,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.name).toBe('Alice');
        expect(result.user.email).toBe('alice@example.com');
        expect(result.user.age).toBe(30);

        // Verify entity was cached
        expect(getEntityMapSize(client)).toBe(1);
      });
    });

    it('should throw when extending with an existing field', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(
        () =>
          ({
            name: t.number, // Trying to override existing field
          }) as any,
      );

      // Error is thrown lazily when shape is accessed (entities are lazy)
      expect(() => {
        // Access shape to trigger reification and validation
        const _shape = ExtendedUser.shape;
      }).toThrow("Cannot extend: field 'name' already exists in type definition");
    });

    it('should throw when extending with the id field', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(
        () =>
          ({
            id: t.string, // Trying to override id
          }) as any,
      );

      // Error is thrown lazily when shape is accessed (entities are lazy)
      expect(() => {
        const _shape = ExtendedUser.shape;
      }).toThrow("Cannot extend: field 'id' already exists in type definition");
    });

    it('should throw when extending with the typename field', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(
        () =>
          ({
            __typename: t.typename('Admin'), // Trying to override typename
          }) as any,
      );

      // Error is thrown lazily when shape is accessed (entities are lazy)
      expect(() => {
        const _shape = ExtendedUser.shape;
      }).toThrow("Cannot extend: field '__typename' already exists in type definition");
    });

    it('should support chained extensions', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const UserWithEmail = BaseUser.extend(() => ({
        email: t.string,
      }));

      const FullUser = UserWithEmail.extend(() => ({
        age: t.number,
        role: t.string,
      }));

      // Verify all fields are present
      expect(FullUser.shape).toBeDefined();
      expect(Object.keys(FullUser.shape)).toContain('__typename');
      expect(Object.keys(FullUser.shape)).toContain('id');
      expect(Object.keys(FullUser.shape)).toContain('name');
      expect(Object.keys(FullUser.shape)).toContain('email');
      expect(Object.keys(FullUser.shape)).toContain('age');
      expect(Object.keys(FullUser.shape)).toContain('role');
    });

    it('should work with nested entities', () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        street: t.string,
        city: t.string,
      }));

      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const UserWithAddress = BaseUser.extend(() => ({
        address: Address,
      }));

      expect(UserWithAddress.shape).toBeDefined();
      expect(UserWithAddress.shape.address).toBe(Address);
    });

    it('should work with optional fields', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.optional(t.string),
        age: t.nullable(t.number),
      }));

      expect(ExtendedUser.shape).toBeDefined();
      expect(ExtendedUser.shape.email).toBeDefined();
      expect(ExtendedUser.shape.age).toBeDefined();
    });

    it('should work with array fields', () => {
      const Tag = entity(() => ({
        __typename: t.typename('Tag'),
        id: t.id,
        name: t.string,
      }));

      const BasePost = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const PostWithTags = BasePost.extend(() => ({
        tags: t.array(Tag),
      }));

      expect(PostWithTags.shape).toBeDefined();
      expect(PostWithTags.shape.tags).toBeDefined();
    });
  });

  describe('ObjectDef.extend()', () => {
    it('should extend an object with new fields', () => {
      const BaseResponse = t.object({
        success: t.boolean,
        timestamp: t.number,
      });

      const ExtendedResponse = BaseResponse.extend({
        message: t.string,
        data: t.string,
      });

      expect(ExtendedResponse.shape).toBeDefined();
      expect(ExtendedResponse.shape.success).toBeDefined();
      expect(ExtendedResponse.shape.timestamp).toBeDefined();
      expect(ExtendedResponse.shape.message).toBeDefined();
      expect(ExtendedResponse.shape.data).toBeDefined();
    });

    it('should preserve the original object unchanged', () => {
      const BaseResponse = t.object({
        success: t.boolean,
      });

      const _ExtendedResponse = BaseResponse.extend({
        message: t.string,
      });

      // Original should not have message field
      expect(Object.keys(BaseResponse.shape)).toEqual(['success']);
      expect((BaseResponse.shape as any).message).toBeUndefined();
    });

    it('should throw when extending with an existing field', () => {
      const BaseResponse = t.object({
        success: t.boolean,
        message: t.string,
      });

      expect(() => {
        BaseResponse.extend({
          success: t.number, // Trying to override existing field
        } as any);
      }).toThrow("Cannot extend: field 'success' already exists in type definition");
    });

    it('should work with nested objects', () => {
      const Metadata = t.object({
        version: t.number,
        updatedAt: t.string,
      });

      const BaseResponse = t.object({
        success: t.boolean,
      });

      const ResponseWithMetadata = BaseResponse.extend({
        metadata: Metadata,
      });

      expect(ResponseWithMetadata.shape).toBeDefined();
      expect(ResponseWithMetadata.shape.metadata).toBe(Metadata);
    });

    it('should work with entities in object fields', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const BaseResponse = t.object({
        success: t.boolean,
      });

      const ResponseWithUser = BaseResponse.extend({
        user: User,
      });

      expect(ResponseWithUser.shape).toBeDefined();
      expect(ResponseWithUser.shape.user).toBe(User);
    });
  });

  describe('Type inference', () => {
    it('should correctly infer types from extended entities', async () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
        age: t.number,
      }));

      // Type inference test - this would fail at compile time if types are wrong
      type UserType = ExtractType<typeof ExtendedUser>;

      // Verify the type has all expected properties
      const _typeCheck: UserType = {
        __typename: 'User',
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      };

      expect(_typeCheck).toBeDefined();
    });

    it('should correctly infer types from extended objects', () => {
      const BaseResponse = t.object({
        success: t.boolean,
      });

      const ExtendedResponse = BaseResponse.extend({
        message: t.string,
      });

      type ResponseType = ExtractType<typeof ExtendedResponse>;

      const _typeCheck: ResponseType = {
        success: true,
        message: 'OK',
      };

      expect(_typeCheck).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle extending with empty object', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const SameUser = BaseUser.extend(() => ({}));

      expect(SameUser.shape).toBeDefined();
      expect(Object.keys(SameUser.shape)).toEqual(['__typename', 'id', 'name']);
    });

    it('should generate different shape keys for original and extended', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
      }));

      // Force shape reification
      const _baseShape = BaseUser.shape;
      const _extendedShape = ExtendedUser.shape;

      // Shape keys should be different
      expect(BaseUser.shapeKey).not.toBe(ExtendedUser.shapeKey);
    });

    it('should work with enum fields', () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(() => ({
        role: t.enum('admin', 'user', 'guest'),
        status: t.const('active'),
      }));

      expect(ExtendedUser.shape).toBeDefined();
      expect(ExtendedUser.shape.role).toBeDefined();
      expect(ExtendedUser.shape.status).toBeDefined();
    });

    it('should lazily evaluate extension fields', () => {
      // This test verifies that extension fields are evaluated lazily
      let baseEvaluated = false;
      let extensionEvaluated = false;

      const BaseUser = entity(() => {
        baseEvaluated = true;
        return {
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        };
      });

      const ExtendedUser = BaseUser.extend(() => {
        extensionEvaluated = true;
        return {
          email: t.string,
        };
      });

      // Neither should be evaluated yet - entity creation is lazy
      expect(baseEvaluated).toBe(false);
      expect(extensionEvaluated).toBe(false);

      // Accessing shape triggers lazy evaluation of BOTH base and extension
      const _shape = ExtendedUser.shape;

      // Now both should be evaluated
      expect(baseEvaluated).toBe(true);
      expect(extensionEvaluated).toBe(true);
    });
  });
});
