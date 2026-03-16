// -----------------------------------------------------------------------------
// Entity System
// -----------------------------------------------------------------------------

import { hashValue } from 'signalium/utils';
import { QueryClient } from './QueryClient.js';
import { ValidatorDef } from './typeDefs.js';
import {
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  Mask,
  ObjectDef,
  ParseResultDef,
  RECORD_KEY,
  RecordDef,
  TypeDef,
  UnionDef,
} from './types.js';
import { typeMaskOf } from './utils.js';

const entries = Object.entries;

export function parseUnionEntities(
  valueType: number,
  value: object | unknown[],
  unionDef: UnionDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
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
      fromCache,
    );
  } else {
    // Use the cached typename field from the union definition
    const typenameField = unionDef.typenameField;
    const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;

    if (typename === undefined || typeof typename !== 'string') {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        // Union of objects/entities requires typename for discrimination
        throw new Error(
          `Typename field '${typenameField}' is required for union discrimination but was not found in the data`,
        );
      }

      return parseRecordEntities(
        value as Record<string, unknown>,
        recordShape as ComplexTypeDef,
        queryClient,
        entityRefs,
        fromCache,
      );
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      throw new Error(`Unknown typename '${typename}' in union`);
    }

    if (matchingDef.mask & Mask.ENTITY) {
      return parseEntity(
        value as Record<string, unknown>,
        matchingDef as EntityDef,
        queryClient,
        entityRefs,
        fromCache,
      );
    }

    return parseObjectEntities(
      value as Record<string, unknown>,
      matchingDef as ObjectDef | EntityDef,
      queryClient,
      entityRefs,
      fromCache,
    );
  }
}

export function parseArrayEntities(
  array: unknown[],
  arrayShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
): unknown[] {
  const result: unknown[] = [];

  for (let i = 0; i < array.length; i++) {
    try {
      result.push(parseEntities(array[i], arrayShape, queryClient, entityRefs, fromCache));
    } catch (e) {
      queryClient.getContext().log?.warn?.('Failed to parse array item, filtering out', {
        index: i,
        value: array[i],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export function parseRecordEntities(
  record: Record<string, unknown>,
  recordShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
): Record<string, unknown> {
  if (typeof recordShape === 'number') {
    return record;
  }

  for (const [key, value] of entries(record)) {
    record[key] = parseEntities(value, recordShape, queryClient, entityRefs, fromCache);
  }

  return record;
}

function parseSubEntityPaths(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
) {
  // Extract shape first to resolve lazy definitions and set subEntityPaths
  const shape = objectShape.shape;
  const subEntityPaths = objectShape.subEntityPaths;

  if (subEntityPaths !== undefined) {
    if (typeof subEntityPaths === 'string') {
      // Single path - avoid array allocation
      const propDef = shape[subEntityPaths];
      obj[subEntityPaths] = parseEntities(
        obj[subEntityPaths],
        propDef as ComplexTypeDef,
        queryClient,
        entityRefs,
        fromCache,
      );
    } else {
      // Multiple paths - iterate directly
      for (const path of subEntityPaths) {
        const propDef = shape[path];
        obj[path] = parseEntities(obj[path], propDef as ComplexTypeDef, queryClient, entityRefs, fromCache);
      }
    }
  }
}

export function parseEntity(
  obj: Record<string, unknown>,
  entityShape: EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
) {
  let key: number | undefined;

  if (fromCache) {
    key = obj.__entityRef as number;
  } else {
    const id = obj[entityShape.idField];

    if (id === undefined) {
      throw new Error(`Entity id is required: ${entityShape.typenameValue}`);
    }

    const desc = `${entityShape.typenameValue}:${id}`;
    key = hashValue([desc, entityShape.shapeKey]);
  }

  const existing = queryClient.getEntity(key);

  if (existing?.parseId === queryClient.currentParseId) {
    return existing.proxy!;
  }

  if (fromCache) {
    const cached = queryClient.getEntity(key);

    if (cached === undefined) {
      throw new Error(`Cached entity ${key} not found in preloaded map`);
    }

    obj = cached.data;
  }

  const childRefs = new Set<number>();

  parseSubEntityPaths(obj, entityShape, queryClient, childRefs, fromCache);

  const typename = entityShape.typenameValue;
  const id = obj[entityShape.idField];

  if (id === undefined) {
    throw new Error(`Entity id is required: ${typename}`);
  }

  // Add this entity's key to the parent's entityRefs (if provided)
  entityRefs?.add(key);

  return queryClient.saveEntity(key, obj, entityShape, childRefs, !fromCache).proxy;
}

export function parseObjectEntities(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
): Record<string, unknown> {
  // Process sub-entity paths first (only these paths can contain entities)
  parseSubEntityPaths(obj, objectShape, queryClient, entityRefs, fromCache);

  return obj;
}

export function parseEntities(
  value: unknown,
  typeDef: TypeDef | ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  fromCache?: boolean,
): unknown {
  if (IS_DEV) {
    const d = typeDef as unknown;
    if (typeof d !== 'number' && typeof d !== 'string' && !(d instanceof Set) && !(d instanceof ValidatorDef)) {
      throw new Error(`Invalid type definition passed to parseEntities: expected a valid TypeDef, got ${typeof d}`);
    }
  }

  const def = typeDef as unknown as ComplexTypeDef;
  const valueType = typeMaskOf(value);
  const defType = def.mask;

  // Handle parseResult wrapper - wraps parsing in try-catch and returns discriminated union
  if ((defType & Mask.PARSE_RESULT) !== 0) {
    try {
      const innerResult = parseEntities(
        value,
        (def as ParseResultDef).shape as ComplexTypeDef,
        queryClient,
        entityRefs,
        fromCache,
      );
      return { success: true as const, value: innerResult };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

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
      fromCache,
    );
  }

  // If it's not a union, AND the value IS an array, then the definition must
  // be an ArrayDef, so we can cast safely here
  if (valueType === Mask.ARRAY) {
    return parseArrayEntities(
      value as unknown[],
      (def as ArrayDef).shape as ComplexTypeDef,
      queryClient,
      entityRefs,
      fromCache,
    );
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
      fromCache,
    );
  }

  if ((defType & Mask.ENTITY) !== 0) {
    return parseEntity(value as Record<string, unknown>, def as EntityDef, queryClient, entityRefs, fromCache);
  }

  return parseObjectEntities(
    value as Record<string, unknown>,
    def as ObjectDef | EntityDef,
    queryClient,
    entityRefs,
    fromCache,
  );
}
