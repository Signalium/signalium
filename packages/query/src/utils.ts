import { Mask } from './types.js';

const isArray = Array.isArray;

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
