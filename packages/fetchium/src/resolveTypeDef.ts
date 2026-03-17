import { ComplexTypeDef, InternalTypeDef, ResponseTypeDef } from './types.js';
import { t, ValidatorDef } from './typeDefs.js';
import { hashValue } from 'signalium/utils';

export function resolveTypeDef(def: ResponseTypeDef): { shape: InternalTypeDef; shapeKey: number } {
  if (typeof def === 'object') {
    if (def instanceof ValidatorDef) {
      return { shape: def as InternalTypeDef, shapeKey: def.shapeKey };
    } else if (def instanceof Set) {
      return { shape: def, shapeKey: hashValue(def) };
    } else {
      const shape = t.object(def as any) as unknown as ComplexTypeDef;
      return { shape, shapeKey: shape.shapeKey };
    }
  }

  return { shape: def as unknown as InternalTypeDef, shapeKey: hashValue(def) };
}
