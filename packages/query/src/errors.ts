import {
  ARRAY_KEY,
  ArrayDef,
  EntityDef,
  Mask,
  ObjectDef,
  RECORD_KEY,
  RecordDef,
  ObjectFieldTypeDef,
  UnionDef,
} from './types.js';
import { CaseInsensitiveSet, getFormatName } from './typeDefs.js';

export function typeToString(type: ObjectFieldTypeDef): string {
  // Handle case-insensitive enum sets
  if (type instanceof CaseInsensitiveSet) {
    const values = Array.from(type).map(v => (typeof v === 'string' ? `"${v}"` : String(v)));
    return values.join(' | ');
  }

  // Handle Set-based constants/enums
  if (type instanceof Set) {
    const values = Array.from(type).map(v => (typeof v === 'string' ? `"${v}"` : String(v)));
    return values.join(' | ');
  }

  // Handle constants
  if (typeof type === 'string') {
    return `"${type}"`;
  }

  if (typeof type === 'boolean') {
    return String(type);
  }

  // Handle primitive masks
  if (typeof type === 'number') {
    // Check for formatted types first
    const hasFormat = (type & (Mask.HAS_STRING_FORMAT | Mask.HAS_NUMBER_FORMAT)) !== 0;
    if (hasFormat) {
      const formatName = getFormatName(type);
      if (formatName) {
        // Show format name instead of base type
        return `"${formatName}"`;
      }
    }

    const types: string[] = [];

    if (type & Mask.UNDEFINED) types.push('undefined');
    if (type & Mask.NULL) types.push('null');
    if (type & Mask.NUMBER) types.push('number');
    if (type & Mask.STRING) types.push('string');
    if (type & Mask.BOOLEAN) types.push('boolean');
    if (type & Mask.OBJECT) types.push('object');
    if (type & Mask.ARRAY) types.push('array');

    if (types.length === 0) {
      return 'unknown';
    }

    return types.length === 1 ? types[0] : types.join(' | ');
  }

  // Handle complex types - CHECK UNION FIRST since it contains other types
  let mask = type.mask;

  if (mask & Mask.UNION) {
    const unionType = type as UnionDef;
    const parts: string[] = [];

    // Add const/enum values from the values Set
    if (unionType.values !== undefined && unionType.values.size > 0) {
      for (const val of unionType.values) {
        const valStr = typeof val === 'string' ? `"${val}"` : String(val);
        parts.push(valStr);
      }
    }

    // Add complex types from the shape object
    if (unionType.shape !== undefined) {
      if (unionType.shape[ARRAY_KEY] !== undefined) {
        parts.push(`Array<${typeToString(unionType.shape[ARRAY_KEY] as ObjectFieldTypeDef)}>`);
      }

      if (unionType.shape[RECORD_KEY] !== undefined) {
        parts.push(`Record<string, ${typeToString(unionType.shape[RECORD_KEY] as ObjectFieldTypeDef)}>`);
      }

      // Add entity/object types by typename
      for (const [key, value] of Object.entries(unionType.shape)) {
        if (key !== (ARRAY_KEY as any) && key !== (RECORD_KEY as any)) {
          // key is the typename value (e.g., "User", "Post")
          parts.push(key);
        }
      }
    }

    mask = unionType.mask;

    // Check for formatted types in union mask
    const hasFormat = (mask & (Mask.HAS_STRING_FORMAT | Mask.HAS_NUMBER_FORMAT)) !== 0;
    if (hasFormat) {
      const formatName = getFormatName(mask);
      if (formatName) {
        parts.push(`"${formatName}"`);
      }
    }

    // Add primitive types from the mask
    if (mask & Mask.UNDEFINED) parts.push('undefined');
    if (mask & Mask.NULL) parts.push('null');
    if (mask & Mask.NUMBER) parts.push('number');
    if (mask & Mask.STRING) parts.push('string');
    if (mask & Mask.BOOLEAN) parts.push('boolean');

    if (parts.length === 0) {
      return 'union';
    }

    return parts.join(' | ');
  }

  if (mask & Mask.ENTITY) {
    return `Entity<${(type as EntityDef).typenameValue}>`;
  }

  if (mask & Mask.ARRAY) {
    const shape = (type as ArrayDef).shape;
    return `Array<${typeToString(shape)}>`;
  }

  if (mask & Mask.RECORD) {
    const shape = (type as RecordDef).shape;
    return `Record<string, ${typeToString(shape)}>`;
  }

  if (mask & Mask.OBJECT) {
    const typename = (type as ObjectDef).typenameValue;
    return typename ? `Object<${typename}>` : 'object';
  }

  return 'unknown';
}

export function typeError(path: string, expectedType: ObjectFieldTypeDef, value: unknown): Error {
  return new TypeError(
    `Validation error at ${path}: expected ${typeToString(expectedType)}, got ${
      typeof value === 'object' ? (value === null ? 'null' : Array.isArray(value) ? 'array' : 'object') : typeof value
    }`,
  );
}
