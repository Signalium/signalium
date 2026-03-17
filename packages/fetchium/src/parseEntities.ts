// -----------------------------------------------------------------------------
// Entity System
// -----------------------------------------------------------------------------

import { hashValue } from 'signalium/utils';
import { QueryClient, type PreloadedEntityMap } from './QueryClient.js';
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
  preloadedEntities?: PreloadedEntityMap,
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
      preloadedEntities,
    );
  } else {
    const typenameField = unionDef.typenameField;
    const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;

    if (typename === undefined || typeof typename !== 'string') {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        throw new Error(
          `Typename field '${typenameField}' is required for union discrimination but was not found in the data`,
        );
      }

      return parseRecordEntities(
        value as Record<string, unknown>,
        recordShape as ComplexTypeDef,
        queryClient,
        entityRefs,
        preloadedEntities,
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
        preloadedEntities,
      );
    }

    return parseObjectEntities(
      value as Record<string, unknown>,
      matchingDef as ObjectDef | EntityDef,
      queryClient,
      entityRefs,
      preloadedEntities,
    );
  }
}

export function parseArrayEntities(
  array: unknown[],
  arrayShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  preloadedEntities?: PreloadedEntityMap,
): unknown[] {
  const result: unknown[] = [];

  for (let i = 0; i < array.length; i++) {
    try {
      result.push(parseEntities(array[i], arrayShape, queryClient, entityRefs, preloadedEntities));
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
  preloadedEntities?: PreloadedEntityMap,
): Record<string, unknown> {
  if (typeof recordShape === 'number') {
    return record;
  }

  for (const [key, value] of entries(record)) {
    record[key] = parseEntities(value, recordShape, queryClient, entityRefs, preloadedEntities);
  }

  return record;
}

function parseSubEntityPaths(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  preloadedEntities?: PreloadedEntityMap,
) {
  const shape = objectShape.shape;
  const subEntityPaths = objectShape.subEntityPaths;

  if (subEntityPaths !== undefined) {
    if (typeof subEntityPaths === 'string') {
      const propDef = shape[subEntityPaths];
      obj[subEntityPaths] = parseEntities(
        obj[subEntityPaths],
        propDef as ComplexTypeDef,
        queryClient,
        entityRefs,
        preloadedEntities,
      );
    } else {
      for (const path of subEntityPaths) {
        const propDef = shape[path];
        obj[path] = parseEntities(obj[path], propDef as ComplexTypeDef, queryClient, entityRefs, preloadedEntities);
      }
    }
  }
}

export function parseEntity(
  obj: Record<string, unknown>,
  entityShape: EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  preloadedEntities?: PreloadedEntityMap,
) {
  let key: number | undefined;

  if (preloadedEntities !== undefined) {
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
    return existing.proxy;
  }

  if (preloadedEntities !== undefined) {
    const preloaded = existing?.data ?? preloadedEntities.get(key);

    if (preloaded === undefined) {
      throw new Error(`Cached entity ${key} not found in preloaded map`);
    }

    obj = preloaded;
  }

  const childRefs = new Set<number>();

  parseSubEntityPaths(obj, entityShape, queryClient, childRefs, preloadedEntities);

  const typename = entityShape.typenameValue;
  const id = obj[entityShape.idField];

  if (id === undefined) {
    throw new Error(`Entity id is required: ${typename}`);
  }

  entityRefs?.add(key);

  return queryClient.saveEntity(key, obj, entityShape, childRefs, preloadedEntities === undefined).proxy;
}

export function parseObjectEntities(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  preloadedEntities?: PreloadedEntityMap,
): Record<string, unknown> {
  parseSubEntityPaths(obj, objectShape, queryClient, entityRefs, preloadedEntities);

  return obj;
}

export function parseEntities(
  value: unknown,
  typeDef: TypeDef | ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Set<number>,
  preloadedEntities?: PreloadedEntityMap,
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

  if ((defType & Mask.PARSE_RESULT) !== 0) {
    try {
      const innerResult = parseEntities(
        value,
        (def as ParseResultDef).shape as ComplexTypeDef,
        queryClient,
        entityRefs,
        preloadedEntities,
      );
      return { success: true as const, value: innerResult };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  if (valueType < Mask.OBJECT || (defType & valueType) === 0) {
    return value;
  }

  if ((defType & Mask.UNION) !== 0) {
    return parseUnionEntities(
      valueType,
      value as Record<string, unknown> | unknown[],
      def as UnionDef,
      queryClient,
      entityRefs,
      preloadedEntities,
    );
  }

  if (valueType === Mask.ARRAY) {
    return parseArrayEntities(
      value as unknown[],
      (def as ArrayDef).shape as ComplexTypeDef,
      queryClient,
      entityRefs,
      preloadedEntities,
    );
  }

  if ((defType & Mask.RECORD) !== 0) {
    return parseRecordEntities(
      value as Record<string, unknown>,
      (def as RecordDef).shape as ComplexTypeDef,
      queryClient,
      entityRefs,
      preloadedEntities,
    );
  }

  if ((defType & Mask.ENTITY) !== 0) {
    return parseEntity(value as Record<string, unknown>, def as EntityDef, queryClient, entityRefs, preloadedEntities);
  }

  return parseObjectEntities(
    value as Record<string, unknown>,
    def as ObjectDef | EntityDef,
    queryClient,
    entityRefs,
    preloadedEntities,
  );
}
