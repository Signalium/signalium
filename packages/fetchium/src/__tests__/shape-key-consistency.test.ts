import { describe, it, expect } from 'vitest';
import { t, defineObject, defineArray, defineRecord, defineParseResult, getShapeKey } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { JsonQuery, queryKeyForClass } from '../query.js';

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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      // Access shapeKey multiple times
      const key1 = getShapeKey(t.entity(User));
      const key2 = getShapeKey(t.entity(User));
      const key3 = getShapeKey(t.entity(User));

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should produce the same shapeKey for identical entity definitions created separately', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      // Force shape reification
      expect(getShapeKey(t.entity(User1))).toBeDefined();
      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce different shapeKeys for entities with different fields', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string; // Different field
      }

      expect(getShapeKey(t.entity(User1))).not.toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce different shapeKeys for entities with different field types', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        age = t.number;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        age = t.string; // Different type
      }

      expect(getShapeKey(t.entity(User1))).not.toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys regardless of field order', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        email = t.string; // Different order
        id = t.id;
        name = t.string;
      }

      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys for nested entities', () => {
      class Address extends Entity {
        __typename = t.typename('Address');
        id = t.id;
        street = t.string;
        city = t.string;
      }

      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        address = t.entity(Address);
      }

      class Address2 extends Entity {
        __typename = t.typename('Address');
        id = t.id;
        street = t.string;
        city = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        address = t.entity(Address2);
      }

      // Both Address entities should have the same shapeKey
      expect(getShapeKey(t.entity(Address))).toBe(getShapeKey(t.entity(Address2)));

      // Both User entities should have the same shapeKey
      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys for entities with arrays', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        tags = t.array(t.string);
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        tags = t.array(t.string);
      }

      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys for entities with records', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        metadata = t.record(t.string);
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        metadata = t.record(t.string);
      }

      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys for entities with enums', () => {
      const Status = t.enum('active', 'inactive', 'pending');

      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        status = Status;
      }

      const Status2 = t.enum('active', 'inactive', 'pending');

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        status = Status2;
      }

      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });

    it('should produce consistent shapeKeys for entities with case-insensitive enums', () => {
      const Status = t.enum.caseInsensitive('active', 'inactive', 'pending');

      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        status = Status;
      }

      const Status2 = t.enum.caseInsensitive('active', 'inactive', 'pending');

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        status = Status2;
      }

      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
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

      expect(getShapeKey(Config1)).toBe(getShapeKey(Config2));
    });

    it('should produce consistent shapeKeys regardless of field order', () => {
      const Config1 = defineObject({
        apiKey: t.string,
        timeout: t.number,
        retries: t.number,
      });

      const Config2 = defineObject({
        retries: t.number,
        apiKey: t.string,
        timeout: t.number,
      });

      expect(getShapeKey(Config1)).toBe(getShapeKey(Config2));
    });

    it('should produce different shapeKeys for objects with different fields', () => {
      const Config1 = defineObject({
        apiKey: t.string,
      });

      const Config2 = defineObject({
        apiKey: t.string,
        timeout: t.number,
      });

      expect(getShapeKey(Config1)).not.toBe(getShapeKey(Config2));
    });
  });

  describe('Array shapeKey consistency', () => {
    it('should produce the same shapeKey for identical array definitions', () => {
      const StringArray1 = defineArray(t.string);
      const StringArray2 = defineArray(t.string);

      expect(getShapeKey(StringArray1)).toBe(getShapeKey(StringArray2));
    });

    it('should produce different shapeKeys for arrays with different element types', () => {
      const StringArray = defineArray(t.string);
      const NumberArray = defineArray(t.number);

      expect(getShapeKey(StringArray)).not.toBe(getShapeKey(NumberArray));
    });
  });

  describe('Record shapeKey consistency', () => {
    it('should produce the same shapeKey for identical record definitions', () => {
      const StringRecord1 = defineRecord(t.string);
      const StringRecord2 = defineRecord(t.string);

      expect(getShapeKey(StringRecord1)).toBe(getShapeKey(StringRecord2));
    });

    it('should produce different shapeKeys for records with different value types', () => {
      const StringRecord = defineRecord(t.string);
      const NumberRecord = defineRecord(t.number);

      expect(getShapeKey(StringRecord)).not.toBe(getShapeKey(NumberRecord));
    });
  });

  describe('Union shapeKey consistency', () => {
    it('should produce the same shapeKey for identical union definitions', () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      const Union1 = t.union(t.entity(User), t.entity(Post));
      const Union2 = t.union(t.entity(User), t.entity(Post));

      expect(getShapeKey(Union1)).toBe(getShapeKey(Union2));
    });

    it('should produce different shapeKeys for unions with different members', () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
      }

      class Comment extends Entity {
        __typename = t.typename('Comment');
        id = t.id;
        content = t.string;
      }

      const Union1 = t.union(t.entity(User), t.entity(Post));
      const Union2 = t.union(t.entity(User), t.entity(Comment));

      expect(getShapeKey(Union1)).not.toBe(getShapeKey(Union2));
    });
  });

  describe('Query shapeKey consistency', () => {
    it('should produce the same shapeKey for identical query definitions', () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser1 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User);
      }

      class GetUser2 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User);
      }

      expect(queryKeyForClass(GetUser1, { id: '123' })).toBe(queryKeyForClass(GetUser2, { id: '123' }));
    });

    it('should produce the same shapeKey for queries with identical inline response shapes', () => {
      class GetUser1 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = {
          id: t.id,
          name: t.string,
          email: t.string,
        };
      }

      class GetUser2 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = {
          id: t.id,
          name: t.string,
          email: t.string,
        };
      }

      expect(queryKeyForClass(GetUser1, { id: '123' })).toBe(queryKeyForClass(GetUser2, { id: '123' }));
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
      expect(getShapeKey(shape1)).not.toBe(getShapeKey(shape2));

      // Now verify that queries using these shapes produce different query keys
      class GetUser1 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = {
          id: t.id,
          name: t.string,
        };
      }

      class GetUser2 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = {
          id: t.id,
          name: t.string,
          email: t.string, // Different field
        };
      }

      const params = { id: '123' };
      const key1 = queryKeyForClass(GetUser1, params);
      const key2 = queryKeyForClass(GetUser2, params);

      expect(key1).not.toBe(key2);
    });

    it('should produce consistent query keys for identical queries', () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User);
      }

      const params = { id: '123' };

      // Query keys should be consistent
      const key1 = queryKeyForClass(GetUser, params);
      const key2 = queryKeyForClass(GetUser, params);
      const key3 = queryKeyForClass(GetUser, params);

      expect(key1).toBe(key2);
      expect(key2).toBe(key3);
    });

    it('should produce the same query keys for identical queries created separately', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class GetUser1 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User1);
      }

      class GetUser2 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User2);
      }

      const params = { id: '123' };

      // Since User1 and User2 have the same shapeKey, query keys should match
      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
      expect(queryKeyForClass(GetUser1, params)).toBe(queryKeyForClass(GetUser2, params));
    });

    it('should produce different query keys for queries with different shapes but same params', () => {
      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string; // Different shape
      }

      class GetUser1 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User1);
      }

      class GetUser2 extends JsonQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = t.entity(User2);
      }

      const params = { id: '123' };

      // Different shapes should produce different query keys
      // NOTE: This test verifies that shapeKey is properly included in query key computation
      expect(getShapeKey(t.entity(User1))).not.toBe(getShapeKey(t.entity(User2)));

      // Queries using different entity shapes should produce different query keys
      const key1 = queryKeyForClass(GetUser1, params);
      const key2 = queryKeyForClass(GetUser2, params);

      expect(key1).not.toBe(key2);
    });
  });

  describe('Complex nested structures', () => {
    it('should produce consistent shapeKeys for deeply nested structures', () => {
      class Address extends Entity {
        __typename = t.typename('Address');
        id = t.id;
        street = t.string;
        city = t.string;
      }

      class Company extends Entity {
        __typename = t.typename('Company');
        id = t.id;
        name = t.string;
      }

      class User1 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        address = t.entity(Address);
        company = t.entity(Company);
        tags = t.array(t.string);
      }

      class Address2 extends Entity {
        __typename = t.typename('Address');
        id = t.id;
        street = t.string;
        city = t.string;
      }

      class Company2 extends Entity {
        __typename = t.typename('Company');
        id = t.id;
        name = t.string;
      }

      class User2 extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        address = t.entity(Address2);
        company = t.entity(Company2);
        tags = t.array(t.string);
      }

      expect(getShapeKey(t.entity(Address))).toBe(getShapeKey(t.entity(Address2)));
      expect(getShapeKey(t.entity(Company))).toBe(getShapeKey(t.entity(Company2)));
      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
    });
  });

  describe('Cross-reboot consistency simulation', () => {
    it('should produce the same shapeKeys when definitions are recreated in the same order', () => {
      function createUserEntity() {
        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
          email = t.string;
        }
        return User;
      }

      const User1 = createUserEntity();
      const User2 = createUserEntity();
      const User3 = createUserEntity();

      // All should have the same shapeKey
      expect(getShapeKey(t.entity(User1))).toBe(getShapeKey(t.entity(User2)));
      expect(getShapeKey(t.entity(User2))).toBe(getShapeKey(t.entity(User3)));
    });

    it('should produce consistent query keys across "reboots"', () => {
      function createQueryClass() {
        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        class GetUser extends JsonQuery {
          params = { id: t.id };
          path = `/users/${this.params.id}`;
          result = t.entity(User);
        }

        return GetUser;
      }

      const GetUser1 = createQueryClass();
      const GetUser2 = createQueryClass();

      const params = { id: '123' };

      // Query keys should be the same even though the definitions were created separately
      expect(queryKeyForClass(GetUser1, params)).toBe(queryKeyForClass(GetUser2, params));
    });
  });

  describe('Hash collision resistance', () => {
    it('should distinguish CaseInsensitiveSet from regular Set with the same values', () => {
      class Item1 extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        status = t.enum('active', 'inactive');
      }

      class Item2 extends Entity {
        __typename = t.typename('Item');
        id = t.id;
        status = t.enum.caseInsensitive('active', 'inactive');
      }

      expect(getShapeKey(t.entity(Item1))).not.toBe(getShapeKey(t.entity(Item2)));
    });

    it('should produce order-independent shapeKeys for CaseInsensitiveSet', () => {
      class Item1 extends Entity {
        __typename = t.typename('CIOrder');
        id = t.id;
        status = t.enum.caseInsensitive('active', 'inactive', 'pending');
      }

      class Item2 extends Entity {
        __typename = t.typename('CIOrder');
        id = t.id;
        status = t.enum.caseInsensitive('pending', 'active', 'inactive');
      }

      expect(getShapeKey(t.entity(Item1))).toBe(getShapeKey(t.entity(Item2)));
    });

    it('should not cancel out when multiple enum fields are present', () => {
      const StatusEnum = t.enum('active', 'inactive');
      const RoleEnum = t.enum('admin', 'user');

      class WithBothEnums extends Entity {
        __typename = t.typename('Multi');
        id = t.id;
        status = StatusEnum;
        role = RoleEnum;
      }

      class WithOnlyStatus extends Entity {
        __typename = t.typename('Multi');
        id = t.id;
        status = StatusEnum;
      }

      class WithOnlyRole extends Entity {
        __typename = t.typename('Multi');
        id = t.id;
        role = RoleEnum;
      }

      const bothKey = getShapeKey(t.entity(WithBothEnums));
      const statusKey = getShapeKey(t.entity(WithOnlyStatus));
      const roleKey = getShapeKey(t.entity(WithOnlyRole));

      expect(bothKey).not.toBe(statusKey);
      expect(bothKey).not.toBe(roleKey);
      expect(statusKey).not.toBe(roleKey);
    });

    it('should not cancel out when multiple case-insensitive enum fields are present', () => {
      const ColorsEnum = t.enum.caseInsensitive('red', 'blue');
      const SizesEnum = t.enum.caseInsensitive('small', 'large');

      class WithBoth extends Entity {
        __typename = t.typename('MultiCI');
        id = t.id;
        color = ColorsEnum;
        size = SizesEnum;
      }

      class WithOnlyColor extends Entity {
        __typename = t.typename('MultiCI');
        id = t.id;
        color = ColorsEnum;
      }

      class WithOnlySize extends Entity {
        __typename = t.typename('MultiCI');
        id = t.id;
        size = SizesEnum;
      }

      const bothKey = getShapeKey(t.entity(WithBoth));
      const colorKey = getShapeKey(t.entity(WithOnlyColor));
      const sizeKey = getShapeKey(t.entity(WithOnlySize));

      expect(bothKey).not.toBe(colorKey);
      expect(bothKey).not.toBe(sizeKey);
      expect(colorKey).not.toBe(sizeKey);
    });

    it('should distinguish array, record, and parseResult wrappers of the same inner type', () => {
      const arrayDef = defineArray(t.string);
      const recordDef = defineRecord(t.string);
      const resultDef = defineParseResult(t.string);

      const arrayKey = getShapeKey(arrayDef);
      const recordKey = getShapeKey(recordDef);
      const resultKey = getShapeKey(resultDef);

      expect(arrayKey).not.toBe(recordKey);
      expect(arrayKey).not.toBe(resultKey);
      expect(recordKey).not.toBe(resultKey);
    });

    it('should distinguish objects from entities with the same shape', () => {
      class AnEntity extends Entity {
        __typename = t.typename('Thing');
        id = t.id;
        name = t.string;
      }

      const anObject = defineObject({
        __typename: t.typename('Thing'),
        id: t.id,
        name: t.string,
      });

      expect(getShapeKey(t.entity(AnEntity))).not.toBe(getShapeKey(anObject));
    });

    it('should produce different shapeKeys for unions in any member order', () => {
      class Alpha extends Entity {
        __typename = t.typename('Alpha');
        id = t.id;
        a = t.string;
      }

      class Beta extends Entity {
        __typename = t.typename('Beta');
        id = t.id;
        b = t.number;
      }

      const union1 = t.union(t.entity(Alpha), t.entity(Beta));
      const union2 = t.union(t.entity(Beta), t.entity(Alpha));

      expect(getShapeKey(union1)).toBe(getShapeKey(union2));
    });

    it('should distinguish unions that differ only in value types from those with defs', () => {
      class OnlyDef extends Entity {
        __typename = t.typename('OnlyDef');
        id = t.id;
        x = t.string;
      }

      const unionWithValues = t.union(t.string, t.number);
      const unionWithDef = t.union(t.string, t.entity(OnlyDef));

      expect(getShapeKey(unionWithDef)).not.toBe(getShapeKey(unionWithValues));
    });

    it('should produce distinct keys for objects with same field names but different enum values', () => {
      class Item1 extends Entity {
        __typename = t.typename('EnumDiff');
        id = t.id;
        color = t.enum('red', 'blue');
      }

      class Item2 extends Entity {
        __typename = t.typename('EnumDiff');
        id = t.id;
        color = t.enum('green', 'yellow');
      }

      expect(getShapeKey(t.entity(Item1))).not.toBe(getShapeKey(t.entity(Item2)));
    });

    it('should produce distinct keys for nested arrays vs nested records', () => {
      class Item1 extends Entity {
        __typename = t.typename('Nested');
        id = t.id;
        data = t.array(t.number);
      }

      class Item2 extends Entity {
        __typename = t.typename('Nested');
        id = t.id;
        data = t.record(t.number);
      }

      expect(getShapeKey(t.entity(Item1))).not.toBe(getShapeKey(t.entity(Item2)));
    });
  });
});
