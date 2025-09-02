import { t, ValidatorDef } from './typeDefs.js';
import { ComplexTypeDef, EntityDef, Mask, ObjectShape } from './types.js';

const entries = Object.entries;
const isArray = Array.isArray;

export function extractShapeMetadata(def: ValidatorDef<any>, shape: ObjectShape): void {
  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof ValidatorDef && (value.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
      if (def.subEntityPaths === undefined) {
        def.subEntityPaths = key;
      } else if (isArray(def.subEntityPaths)) {
        def.subEntityPaths.push(key);
      } else {
        def.subEntityPaths = [def.subEntityPaths, key];
      }
    }
    // Check if this is a typename field (plain string value)
    if (typeof value === 'string') {
      if (def.typenameField !== undefined) {
        throw new Error(`Duplicate typename field: ${key}`);
      }

      def.typenameField = key;
      def.typenameValue = value;
    }
    // Check if this is an id field (Mask.ID)
    else if (typeof value === 'number' && (value & Mask.ID) !== 0) {
      if (def.idField !== undefined) {
        throw new Error(`Duplicate id field: ${key}`);
      }

      def.idField = key;
    }
  }
}

export function extractShape<T extends ComplexTypeDef>(def: T): T extends EntityDef ? ObjectShape : T['shape'] {
  let shape = def.shape;

  if (typeof shape === 'function') {
    shape = def.shape = shape(t);
    extractShapeMetadata(def as ValidatorDef<any>, shape);
  }

  return shape as T extends EntityDef ? ObjectShape : T['shape'];
}

export function typeMaskOf(value: unknown): Mask {
  if (value === null) return Mask.NULL;

  switch (typeof value) {
    case 'number':
      return Mask.NUMBER;
    case 'string':
      return Mask.STRING;
    case 'boolean':
      return Mask.BOOLEAN;
    case 'undefined':
      return Mask.UNDEFINED;
    case 'object':
      return isArray(value) ? Mask.ARRAY : Mask.OBJECT;
    default:
      throw new Error(`Invalid type: ${typeof value}`);
  }
}
