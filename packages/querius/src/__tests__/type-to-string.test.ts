import { describe, it, expect } from 'vitest';
import { typeToString } from '../errors.js';
import { t } from '../typeDefs.js';

/**
 * Unit tests for typeToString function
 * Tests the debug logging representation of TypeDef types
 */

describe('typeToString', () => {
  describe('Primitive Types', () => {
    it('should convert string type to "string"', () => {
      expect(typeToString(t.string as any)).toBe('string');
    });

    it('should convert number type to "number"', () => {
      expect(typeToString(t.number as any)).toBe('number');
    });

    it('should convert boolean type to "boolean"', () => {
      expect(typeToString(t.boolean as any)).toBe('boolean');
    });

    it('should convert null type to "null"', () => {
      expect(typeToString(t.null as any)).toBe('null');
    });

    it('should convert undefined type to "undefined"', () => {
      expect(typeToString(t.undefined as any)).toBe('undefined');
    });
  });

  describe('Constant Values', () => {
    it('should convert string constant to quoted string', () => {
      expect(typeToString(t.const('user') as any)).toBe('"user"');
    });

    it('should convert boolean constant to boolean string', () => {
      expect(typeToString(t.const(true) as any)).toBe('true');
      expect(typeToString(t.const(false) as any)).toBe('false');
    });

    it('should convert number constant to number string', () => {
      const numConst = t.const(42);
      expect(typeToString(numConst as any)).toBe('42');
    });
  });

  describe('Union Types', () => {
    it('should convert primitive union types', () => {
      const unionType = t.union(t.string, t.number);
      const result = typeToString(unionType as any);
      // Union of primitives should show both types
      expect(result).toMatch(/string.*number|number.*string/);
    });

    it('should convert union with null', () => {
      const unionType = t.union(t.string, t.null);
      const result = typeToString(unionType as any);
      expect(result).toContain('null');
      expect(result).toContain('string');
    });

    it('should convert union with undefined', () => {
      const unionType = t.union(t.number, t.undefined);
      const result = typeToString(unionType as any);
      expect(result).toContain('undefined');
      expect(result).toContain('number');
    });

    it('should convert value union with types', () => {
      // Union with both types and values
      const unionType = t.union(t.string, t.const('admin'));
      const result = typeToString(unionType as any);
    });
  });

  describe('Array Types', () => {
    it('should convert array of primitives', () => {
      expect(typeToString(t.array(t.string) as any)).toBe('Array<string>');
      expect(typeToString(t.array(t.number) as any)).toBe('Array<number>');
    });

    it('should convert nested arrays', () => {
      const nestedArray = t.array(t.array(t.string));
      expect(typeToString(nestedArray as any)).toBe('Array<Array<string>>');
    });
  });

  describe('Record Types', () => {
    it('should convert record of primitives', () => {
      expect(typeToString(t.record(t.string) as any)).toBe('Record<string, string>');
      expect(typeToString(t.record(t.number) as any)).toBe('Record<string, number>');
    });

    it('should convert record of arrays', () => {
      const recordOfArrays = t.record(t.array(t.string));
      expect(typeToString(recordOfArrays as any)).toBe('Record<string, Array<string>>');
    });
  });

  describe('Object Types', () => {
    it('should convert object without typename', () => {
      const obj = t.object({ name: t.string, age: t.number });
      expect(typeToString(obj as any)).toBe('object');
    });
  });

  describe('Complex Nested Types', () => {
    it('should handle array of records', () => {
      const type = t.array(t.record(t.string));
      expect(typeToString(type as any)).toBe('Array<Record<string, string>>');
    });

    it('should handle record of arrays', () => {
      const type = t.record(t.array(t.number));
      expect(typeToString(type as any)).toBe('Record<string, Array<number>>');
    });

    it('should handle union of primitives with null and undefined', () => {
      const type = t.union(t.string, t.number, t.null, t.undefined);
      const result = typeToString(type as any);
      expect(result).toContain('string');
      expect(result).toContain('number');
      expect(result).toContain('null');
      expect(result).toContain('undefined');
    });
  });
});
