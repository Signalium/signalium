// -----------------------------------------------------------------------------
// Entity System
// -----------------------------------------------------------------------------

import { hashValue } from 'signalium/utils';
import { QueryClient } from './QueryClient.js';
import {
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  Mask,
  ObjectDef,
  RECORD_KEY,
  RecordDef,
  UnionDef,
} from './types.js';
import { extractShape, typeMaskOf } from './utils.js';

const entries = Object.entries;

export function parseUnionEntities(
  valueType: number,
  value: object | unknown[],
  unionDef: UnionDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
): unknown {
  if (valueType === Mask.ARRAY) {
    const shape = unionDef.shape![ARRAY_KEY];

    if (shape === undefined || typeof shape === 'number') {
      return value;
    }

    return parseArrayEntities(
      value as unknown[],
      { mask: Mask.ARRAY, shape, values: undefined } as ArrayDef,
      queryClient,
      entityRefs,
    );
  } else {
    // Use the cached typename field from the union definition
    const typenameField = unionDef.typenameField;
    const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;

    if (typename === undefined || typeof typename !== 'string') {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        return value;
      }

      return parseRecordEntities(
        value as Record<string, unknown>,
        recordShape as ComplexTypeDef,
        queryClient,
        entityRefs,
      );
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      return value;
    }

    return parseObjectEntities(
      value as Record<string, unknown>,
      matchingDef as ObjectDef | EntityDef,
      queryClient,
      entityRefs,
    );
  }
}

export function parseArrayEntities(
  array: unknown[],
  arrayShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
): unknown[] {
  for (let i = 0; i < array.length; i++) {
    array[i] = parseEntities(array[i], arrayShape, queryClient, entityRefs);
  }

  return array;
}

export function parseRecordEntities(
  record: Record<string, unknown>,
  recordShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
): Record<string, unknown> {
  if (typeof recordShape === 'number') {
    return record;
  }

  for (const [key, value] of entries(record)) {
    record[key] = parseEntities(value, recordShape, queryClient, entityRefs);
  }

  return record;
}

export function parseObjectEntities(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
): Record<string, unknown> {
  const entityRefId = obj.__entityRef as number;

  // Check if this is an entity reference (from cache)
  if (typeof entityRefId === 'number') {
    return queryClient.hydrateEntity(entityRefId, objectShape as EntityDef).proxy;
  }

  // Process sub-entity paths (only these paths can contain entities)
  const { mask } = objectShape;

  const childRefs = mask & Mask.ENTITY ? new Set<number>() : entityRefs;

  // Extract shape first to resolve lazy definitions and set subEntityPaths
  const shape = extractShape(objectShape);
  const subEntityPaths = objectShape.subEntityPaths;

  if (subEntityPaths !== undefined) {
    if (typeof subEntityPaths === 'string') {
      // Single path - avoid array allocation
      const propDef = shape[subEntityPaths];
      obj[subEntityPaths] = parseEntities(obj[subEntityPaths], propDef as ComplexTypeDef, queryClient, childRefs);
    } else {
      // Multiple paths - iterate directly
      for (const path of subEntityPaths) {
        const propDef = shape[path];
        obj[path] = parseEntities(obj[path], propDef as ComplexTypeDef, queryClient, childRefs);
      }
    }
  }

  // Handle entity replacement (entities get cached and replaced with proxies)
  if (mask & Mask.ENTITY) {
    const entityDef = objectShape as EntityDef;
    const typename = entityDef.typenameValue;
    const id = obj[entityDef.idField];

    const desc = `${typename}:${id}`;
    const key = hashValue(desc);

    // Add this entity's key to the parent's entityRefs (if provided)
    if (entityRefs !== undefined) {
      entityRefs.add(key);
    }

    return queryClient.saveEntity(key, obj, entityDef, childRefs).proxy;
  }

  // Return the processed object (even if not an entity)
  return obj;
}

export function parseEntities(
  value: unknown,
  def: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
): unknown {
  const valueType = typeMaskOf(value);
  const defType = def.mask;

  // Skip primitives and incompatible types - they can't contain entities
  // Note: We silently return incompatible values rather than erroring
  if (valueType < Mask.OBJECT || (defType & valueType) === 0) {
    return value;
  }

  // Handle unions first - they can contain multiple types, and all of the union
  // logic is handled above, so we return early here if it's a union
  if ((defType & Mask.UNION) !== 0) {
    return parseUnionEntities(
      valueType,
      value as Record<string, unknown> | unknown[],
      def as UnionDef,
      queryClient,
      entityRefs,
    );
  }

  // If it's not a union, AND the value IS an array, then the definition must
  // be an ArrayDef, so we can cast safely here
  if (valueType === Mask.ARRAY) {
    return parseArrayEntities(value as unknown[], (def as ArrayDef).shape as ComplexTypeDef, queryClient, entityRefs);
  }

  // Now we know the value is an object, so def must be a RecordDef, ObjectDef
  // or EntityDef. We first check to see if it's a RecordDef, and if so, we can
  // cast it here and return early.
  if ((defType & Mask.RECORD) !== 0) {
    return parseRecordEntities(
      value as Record<string, unknown>,
      (def as RecordDef).shape as ComplexTypeDef,
      queryClient,
      entityRefs,
    );
  }

  // Now we know the def is an ObjectDef or EntityDef. These are both handled
  // the same way _mostly_, with Entities just returning a proxy instead of the
  // object itself
  return parseObjectEntities(value as Record<string, unknown>, def as ObjectDef | EntityDef, queryClient, entityRefs);
}
