import { describe, it, expect } from 'vitest';
import { t } from '../typeDefs.js';
import { Mask } from '../types.js';
import { typeToString } from '../errors.js';

/**
 * Unit tests for t.nullish(), t.optional(), and t.nullable() API methods
 * Tests both primitive types (Mask numbers) and complex types (ValidatorDef instances)
 */

describe('t.nullish/optional/nullable API', () => {
  describe('t.nullish()', () => {
    describe('with primitives', () => {
      it('should add undefined and null to string type', () => {
        const result = t.nullish(t.string);
        expect(typeof result).toBe('number');
        expect(result & Mask.STRING).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeTruthy();
        expect(result & Mask.NULL).toBeTruthy();
        expect(typeToString(result)).toBe('undefined | null | string');
      });

      it('should add undefined and null to number type', () => {
        const result = t.nullish(t.number);
        expect(typeof result).toBe('number');
        expect(result & Mask.NUMBER).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeTruthy();
        expect(result & Mask.NULL).toBeTruthy();
        expect(typeToString(result)).toBe('undefined | null | number');
      });

      it('should add undefined and null to boolean type', () => {
        const result = t.nullish(t.boolean);
        expect(typeof result).toBe('number');
        expect(result & Mask.BOOLEAN).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeTruthy();
        expect(result & Mask.NULL).toBeTruthy();
        expect(typeToString(result)).toBe('undefined | null | boolean');
      });

      it('should be idempotent for primitives', () => {
        const result1 = t.nullish(t.string);
        const result2 = t.nullish(result1);
        expect(result1).toBe(result2);
      });
    });

    describe('with complex types', () => {
      it('should return cached nullish property for arrays', () => {
        const arrayType = t.array(t.string);
        const result = t.nullish(arrayType);

        expect(result).toBe(arrayType.nullish);
        expect((result as any).mask & Mask.UNDEFINED).toBeTruthy();
        expect((result as any).mask & Mask.NULL).toBeTruthy();
        expect((result as any).mask & Mask.ARRAY).toBeTruthy();
      });

      it('should return cached nullish property for objects', () => {
        const objectType = t.object({
          __typename: t.typename('User'),
          name: t.string,
        });
        const result = t.nullish(objectType);

        expect(result).toBe(objectType.nullish);
        expect((result as any).mask & Mask.UNDEFINED).toBeTruthy();
        expect((result as any).mask & Mask.NULL).toBeTruthy();
        expect((result as any).mask & Mask.OBJECT).toBeTruthy();
      });

      it('should return cached nullish property for records', () => {
        const recordType = t.record(t.number);
        const result = t.nullish(recordType);

        expect(result).toBe(recordType.nullish);
        expect((result as any).mask & Mask.UNDEFINED).toBeTruthy();
        expect((result as any).mask & Mask.NULL).toBeTruthy();
        expect((result as any).mask & Mask.RECORD).toBeTruthy();
      });

      it('should return same instance on repeated calls (cached)', () => {
        const arrayType = t.array(t.string);
        const result1 = t.nullish(arrayType);
        const result2 = t.nullish(arrayType);

        expect(result1).toBe(result2);
      });
    });

    describe('with constant/enum types', () => {
      it('should create union with undefined and null for const', () => {
        const constType = t.const('active');
        const result = t.nullish(constType);

        expect(typeToString(result)).toBe('"active" | undefined | null');
      });

      it('should create union with undefined and null for enum', () => {
        const enumType = t.enum('red', 'blue', 'green');
        const result = t.nullish(enumType);

        const str = typeToString(result);
        expect(str).toContain('undefined');
        expect(str).toContain('null');
        expect(str).toContain('"red"');
        expect(str).toContain('"blue"');
        expect(str).toContain('"green"');
      });
    });
  });

  describe('t.optional()', () => {
    describe('with primitives', () => {
      it('should add undefined to string type', () => {
        const result = t.optional(t.string);
        expect(typeof result).toBe('number');
        expect(result & Mask.STRING).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeTruthy();
        expect(result & Mask.NULL).toBeFalsy();
        expect(typeToString(result)).toBe('undefined | string');
      });

      it('should add undefined to number type', () => {
        const result = t.optional(t.number);
        expect(typeof result).toBe('number');
        expect(result & Mask.NUMBER).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeTruthy();
        expect(result & Mask.NULL).toBeFalsy();
        expect(typeToString(result)).toBe('undefined | number');
      });

      it('should be idempotent for primitives', () => {
        const result1 = t.optional(t.boolean);
        const result2 = t.optional(result1);
        expect(result1).toBe(result2);
      });
    });

    describe('with complex types', () => {
      it('should return cached optional property for arrays', () => {
        const arrayType = t.array(t.number);
        const result = t.optional(arrayType);

        expect(result).toBe(arrayType.optional);
        expect((result as any).mask & Mask.UNDEFINED).toBeTruthy();
        expect((result as any).mask & Mask.NULL).toBeFalsy();
        expect((result as any).mask & Mask.ARRAY).toBeTruthy();
      });

      it('should return cached optional property for objects', () => {
        const objectType = t.object({
          __typename: t.typename('Post'),
          title: t.string,
        });
        const result = t.optional(objectType);

        expect(result).toBe(objectType.optional);
        expect((result as any).mask & Mask.UNDEFINED).toBeTruthy();
        expect((result as any).mask & Mask.NULL).toBeFalsy();
        expect((result as any).mask & Mask.OBJECT).toBeTruthy();
      });

      it('should return same instance on repeated calls (cached)', () => {
        const recordType = t.record(t.string);
        const result1 = t.optional(recordType);
        const result2 = t.optional(recordType);

        expect(result1).toBe(result2);
      });
    });

    describe('with constant/enum types', () => {
      it('should create union with undefined for const', () => {
        const constType = t.const(42);
        const result = t.optional(constType);

        expect(typeToString(result)).toBe('42 | undefined');
      });

      it('should create union with undefined for enum', () => {
        const enumType = t.enum(1, 2, 3);
        const result = t.optional(enumType);

        const str = typeToString(result);
        expect(str).toContain('undefined');
        expect(str).not.toContain('null');
      });
    });
  });

  describe('t.nullable()', () => {
    describe('with primitives', () => {
      it('should add null to string type', () => {
        const result = t.nullable(t.string);
        expect(typeof result).toBe('number');
        expect(result & Mask.STRING).toBeTruthy();
        expect(result & Mask.NULL).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeFalsy();
        expect(typeToString(result)).toBe('null | string');
      });

      it('should add null to number type', () => {
        const result = t.nullable(t.number);
        expect(typeof result).toBe('number');
        expect(result & Mask.NUMBER).toBeTruthy();
        expect(result & Mask.NULL).toBeTruthy();
        expect(result & Mask.UNDEFINED).toBeFalsy();
        expect(typeToString(result)).toBe('null | number');
      });

      it('should be idempotent for primitives', () => {
        const result1 = t.nullable(t.boolean);
        const result2 = t.nullable(result1);
        expect(result1).toBe(result2);
      });
    });

    describe('with complex types', () => {
      it('should return cached nullable property for arrays', () => {
        const arrayType = t.array(t.boolean);
        const result = t.nullable(arrayType);

        expect(result).toBe(arrayType.nullable);
        expect((result as any).mask & Mask.NULL).toBeTruthy();
        expect((result as any).mask & Mask.UNDEFINED).toBeFalsy();
        expect((result as any).mask & Mask.ARRAY).toBeTruthy();
      });

      it('should return cached nullable property for objects', () => {
        const objectType = t.object({
          __typename: t.typename('Comment'),
          text: t.string,
        });
        const result = t.nullable(objectType);

        expect(result).toBe(objectType.nullable);
        expect((result as any).mask & Mask.NULL).toBeTruthy();
        expect((result as any).mask & Mask.UNDEFINED).toBeFalsy();
        expect((result as any).mask & Mask.OBJECT).toBeTruthy();
      });

      it('should return same instance on repeated calls (cached)', () => {
        const arrayType = t.array(t.string);
        const result1 = t.nullable(arrayType);
        const result2 = t.nullable(arrayType);

        expect(result1).toBe(result2);
      });
    });

    describe('with constant/enum types', () => {
      it('should create union with null for const', () => {
        const constType = t.const(true);
        const result = t.nullable(constType);

        expect(typeToString(result)).toBe('true | null');
      });

      it('should create union with null for enum', () => {
        const enumType = t.enum('a', 'b', 'c');
        const result = t.nullable(enumType);

        const str = typeToString(result);
        expect(str).toContain('null');
        expect(str).not.toContain('undefined');
      });
    });
  });

  describe('Equivalence with t.union()', () => {
    it('t.nullish(t.string) should be equivalent to t.union(t.string, t.null, t.undefined)', () => {
      const nullish = t.nullish(t.string);
      const union = t.union(t.string, t.null, t.undefined);

      expect(nullish).toBe(union);
    });

    it('t.optional(t.number) should be equivalent to t.union(t.number, t.undefined)', () => {
      const optional = t.optional(t.number);
      const union = t.union(t.number, t.undefined);

      expect(optional).toBe(union);
    });

    it('t.nullable(t.boolean) should be equivalent to t.union(t.boolean, t.null)', () => {
      const nullable = t.nullable(t.boolean);
      const union = t.union(t.boolean, t.null);

      expect(nullable).toBe(union);
    });

    it('complex types should have equivalent masks', () => {
      const arrayType = t.array(t.string);
      const nullishArray = t.nullish(arrayType);

      // The nullish version should have the same masks as doing it manually
      expect((nullishArray as any).mask & Mask.ARRAY).toBeTruthy();
      expect((nullishArray as any).mask & Mask.NULL).toBeTruthy();
      expect((nullishArray as any).mask & Mask.UNDEFINED).toBeTruthy();
    });
  });

  describe('Combining methods', () => {
    it('should handle chaining with primitives', () => {
      const optional = t.optional(t.string);
      const nullish = t.nullish(optional);

      expect(nullish & Mask.STRING).toBeTruthy();
      expect(nullish & Mask.UNDEFINED).toBeTruthy();
      expect(nullish & Mask.NULL).toBeTruthy();
    });

    it('should handle chaining with complex types', () => {
      const arrayType = t.array(t.number);
      const optional = t.optional(arrayType);
      const nullish = t.nullish(optional);

      expect((nullish as any).mask & Mask.ARRAY).toBeTruthy();
      expect((nullish as any).mask & Mask.UNDEFINED).toBeTruthy();
      expect((nullish as any).mask & Mask.NULL).toBeTruthy();
    });
  });
});
