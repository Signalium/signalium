// -----------------------------------------------------------------------------
// Parse System
//
// parseEntities/parseData: Validates, formats, produces parsed entity data
//   objects. Entities are deduplicated via ctx.seen/ctx.seenByKey.
// -----------------------------------------------------------------------------

import { hashValue } from 'signalium/utils';
import type { QueryClient, PreloadedEntityMap } from './QueryClient.js';
import { CaseInsensitiveSet, FormattedValue, FORMAT_MASK_SHIFT, ValidatorDef } from './typeDefs.js';
import { typeError } from './errors.js';
import {
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  InternalObjectFieldTypeDef,
  LiveFieldType,
  Mask,
  ObjectDef,
  ParseResultDef,
  RECORD_KEY,
  RecordDef,
  TypeDef,
  UnionDef,
} from './types.js';
import { typeMaskOf } from './utils.js';
import { PROXY_ID } from './proxyId.js';

import type { WarnFn } from './proxy.js';

const entries = Object.entries;
const noopWarn: WarnFn = () => {};

// ======================================================
// ParsedEntity — lightweight struct for parsed entity data
// ======================================================

export interface ParsedEntity {
  key: number;
  shape: EntityDef;
  data: Record<string, unknown>;
  /** Set for partial event updates — restricts mergeFields to only these keys. */
  rawKeys: Set<string> | undefined;
}

// ======================================================
// Parse context — bundles threading parameters
// ======================================================

export class ParseContext {
  queryClient: QueryClient | undefined = undefined;
  preloadedEntities: PreloadedEntityMap | undefined = undefined;
  warn: WarnFn = noopWarn;
  /** When true, missing optional fields on existing entities are set to
   *  undefined. False for mutation events (truly partial payloads). */
  isPartialEvent: boolean = false;
  seen: Map<Record<string, unknown>, ParsedEntity> | undefined = undefined;
  seenByKey: Map<number, ParsedEntity> | undefined = undefined;

  reset(
    queryClient: QueryClient | undefined,
    preloadedEntities: PreloadedEntityMap | undefined,
    warn: WarnFn,
    isPartialEvent: boolean = false,
  ): void {
    this.queryClient = queryClient;
    this.preloadedEntities = preloadedEntities;
    this.warn = warn;
    this.isPartialEvent = isPartialEvent;
    if (queryClient !== undefined) {
      if (this.seen === undefined) {
        this.seen = new Map();
        this.seenByKey = new Map();
      } else {
        this.seen.clear();
        this.seenByKey!.clear();
      }
    }
  }
}

export interface ParseResult {
  data: unknown;
  ctx: ParseContext;
}

// ======================================================
// Entry points
// ======================================================

/**
 * Parse data: validates types, applies formats, produces parsed entity data
 * objects (stored in ctx.seen). Does NOT touch the entity store.
 *
 * After parsing, call applyEntityRefs() to apply entities and reify the tree.
 */
export function parseEntities(value: unknown, typeDef: TypeDef | ComplexTypeDef, ctx: ParseContext): unknown {
  return parseData(value, typeDef, ctx, '');
}

/**
 * Standalone value parser for non-entity values. Used by tests and LiveCollection.
 * Validates types and applies eager formats. Does not perform entity resolution.
 */
export function parseValue(
  value: unknown,
  typeDef: TypeDef | ComplexTypeDef,
  path: string,
  warn: WarnFn = noopWarn,
): unknown {
  const ctx = new ParseContext();
  ctx.reset(undefined, undefined, warn);
  const result = parseData(value, typeDef, ctx, path);
  return unwrapFormattedValues(result);
}

/**
 * Parse a single entity. Returns its parsed data object.
 */
export function parseEntity(
  obj: Record<string, unknown>,
  entityShape: EntityDef,
  ctx: ParseContext,
): Record<string, unknown> {
  return parseEntityData(obj, entityShape, ctx);
}

// ======================================================
// Internal helpers
// ======================================================

function unwrapFormattedValues(value: unknown): unknown {
  if (value instanceof FormattedValue) {
    return value.getValue();
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = unwrapFormattedValues(value[i]);
    }
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = unwrapFormattedValues(obj[key]);
    }
  }
  return value;
}

function parseFormattedValue(
  mask: number,
  value: unknown,
  ctx: ParseContext,
  path: string,
): FormattedValue | undefined {
  const formatId = mask >> FORMAT_MASK_SHIFT;
  const eager = (mask & Mask.IS_EAGER_FORMAT) !== 0;
  if (eager) {
    try {
      return new FormattedValue(value, formatId, true);
    } catch (e) {
      if ((mask & Mask.UNDEFINED) !== 0) {
        ctx.warn('Invalid formatted value for optional type, defaulting to undefined', {
          value,
          path,
          error: e instanceof Error ? e.message : String(e),
        });
        return undefined;
      }
      throw e;
    }
  }
  return new FormattedValue(value, formatId, false);
}

// ======================================================
// Parse dispatcher
// ======================================================

function parseData(value: unknown, typeDef: TypeDef | ComplexTypeDef, ctx: ParseContext, path: string): unknown {
  const def = typeDef as unknown as InternalObjectFieldTypeDef;

  if (def instanceof CaseInsensitiveSet) {
    const canonical = def.get(value);
    if (canonical === undefined) throw typeError(path, def as any, value);
    return canonical;
  }

  if (def instanceof Set) {
    if (!def.has(value as string | boolean | number)) throw typeError(path, def as any, value);
    return value;
  }

  if (typeof def === 'string') {
    if (value === undefined || value === null) return def;
    if (value !== def) throw typeError(path, def, value);
    return value;
  }

  if (typeof def === 'number') {
    const valueType = typeMaskOf(value);

    if ((def & valueType) === 0) {
      if ((def & Mask.UNDEFINED) !== 0) {
        ctx.warn('Invalid value for optional type, defaulting to undefined', { value, path });
        return undefined;
      }
      throw typeError(path, def, value);
    }

    if ((def & Mask.HAS_FORMAT) !== 0 && value !== null && value !== undefined) {
      return parseFormattedValue(def, value, ctx, path);
    }

    return value;
  }

  // --- Complex types (ValidatorDef) ---

  const propMask = def.mask;

  const liveConfig = (def as unknown as ValidatorDef<unknown>)._liveConfig;
  if (liveConfig !== undefined && liveConfig.type === LiveFieldType.Value) {
    if (liveConfig.valueType !== undefined) {
      return parseData(value, liveConfig.valueType as unknown as TypeDef, ctx, path);
    }
    return value;
  }

  if ((propMask & Mask.PARSE_RESULT) !== 0) {
    try {
      const innerResult = parseData(value, (def as unknown as ParseResultDef).shape as ComplexTypeDef, ctx, path);
      return { success: true as const, value: innerResult };
    } catch (e) {
      return { success: false as const, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  const valueType = typeMaskOf(value);

  if ((propMask & valueType) === 0 && !def.values?.has(value as string | boolean | number)) {
    if ((propMask & Mask.UNDEFINED) !== 0) {
      ctx.warn('Invalid value for optional type, defaulting to undefined', { value, path });
      return undefined;
    }
    throw typeError(path, propMask, value);
  }

  if (valueType < Mask.OBJECT) {
    if ((propMask & Mask.HAS_FORMAT) !== 0 && value !== null && value !== undefined) {
      return parseFormattedValue(propMask, value, ctx, path);
    }

    return value;
  }

  if ((propMask & Mask.UNION) !== 0) {
    return parseUnionData(valueType, value as Record<string, unknown> | unknown[], def as UnionDef, ctx, path);
  }

  if (valueType === Mask.ARRAY) {
    return parseArrayData(value as unknown[], (def as ArrayDef).shape as ComplexTypeDef, ctx, path);
  }

  if ((propMask & Mask.RECORD) !== 0) {
    return parseRecordData(value as Record<string, unknown>, (def as RecordDef).shape as ComplexTypeDef, ctx, path);
  }

  if ((propMask & Mask.ENTITY) !== 0 && ctx.queryClient !== undefined) {
    return parseEntityData(value as Record<string, unknown>, def as EntityDef, ctx);
  }

  return parseObjectData(value as Record<string, unknown>, def as ObjectDef | EntityDef, ctx, path);
}

// ======================================================
// Union
// ======================================================

function parseUnionData(
  valueType: number,
  value: Record<string, unknown> | unknown[],
  unionDef: UnionDef,
  ctx: ParseContext,
  path: string,
): unknown {
  if (valueType === Mask.ARRAY) {
    const shape = unionDef.shape![ARRAY_KEY];

    if (shape === undefined || typeof shape === 'number') {
      return value;
    }

    return parseArrayData(value as unknown[], shape as ComplexTypeDef, ctx, path);
  } else {
    const typenameField = unionDef.typenameField;
    const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;

    if (typename === undefined || typeof typename !== 'string') {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined) {
        throw new Error(
          `Typename field '${typenameField}' is required for union discrimination but was not found in the data`,
        );
      }

      return parseRecordData(value as Record<string, unknown>, recordShape as ComplexTypeDef, ctx, path);
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      throw new Error(`Unknown typename '${typename}' in union`);
    }

    if (matchingDef.mask & Mask.ENTITY && ctx.queryClient !== undefined) {
      return parseEntityData(value as Record<string, unknown>, matchingDef as EntityDef, ctx);
    }

    return parseObjectData(value as Record<string, unknown>, matchingDef as ObjectDef | EntityDef, ctx, path);
  }
}

// ======================================================
// Array / Record / Object
// ======================================================

function parseArrayData(array: unknown[], itemShape: ComplexTypeDef, ctx: ParseContext, path: string): unknown[] {
  const result: unknown[] = [];

  for (let i = 0; i < array.length; i++) {
    try {
      result.push(parseData(array[i], itemShape as unknown as TypeDef, ctx, `${path}[${i}]`));
    } catch (e) {
      ctx.warn('Failed to parse array item, filtering out', {
        index: i,
        value: array[i],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

function parseRecordData(
  record: Record<string, unknown>,
  valueShape: ComplexTypeDef,
  ctx: ParseContext,
  path: string,
): Record<string, unknown> {
  for (const [key, value] of entries(record)) {
    record[key] = parseData(value, valueShape as unknown as TypeDef, ctx, `${path}["${key}"]`);
  }

  return record;
}

function parseObjectData(
  obj: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  ctx: ParseContext,
  path: string,
): Record<string, unknown> {
  if (PROXY_ID.has(obj)) {
    return obj;
  }

  const shape = objectShape.shape;

  for (const [key, propShape] of entries(shape)) {
    obj[key] = parseData(obj[key], propShape as unknown as TypeDef, ctx, `${path}.${key}`);
  }

  return obj;
}

// ======================================================
// Entity — parse into parsed data object, register in seen
// ======================================================

function parseEntityData(
  obj: Record<string, unknown>,
  entityShape: EntityDef,
  ctx: ParseContext,
): Record<string, unknown> {
  const queryClient = ctx.queryClient!;
  const preloadedEntities = ctx.preloadedEntities;
  let key: number;
  let id: string | number;

  if (preloadedEntities !== undefined) {
    key = obj.__entityRef as number;
    // For preloaded entities, the id is embedded in the key. Use key as id
    // since the original value may not survive JSON serialization (symbols).
    id = key;
  } else {
    const rawId = (obj as Record<string | symbol, unknown>)[entityShape.idField];

    if (rawId === undefined || rawId === null || (typeof rawId !== 'string' && typeof rawId !== 'number')) {
      throw new Error(`Entity id must be a string or number: ${entityShape.typenameValue} (got ${typeof rawId})`);
    }

    id = rawId;
    key = hashValue([entityShape.typenameValue, id]);
  }

  const existingEntry = ctx.seenByKey!.get(key);
  if (existingEntry !== undefined) {
    return existingEntry.data;
  }

  if (preloadedEntities !== undefined) {
    const existing = queryClient.entityMap.getEntity(key);
    const preloaded = existing?.data ?? preloadedEntities.get(key);

    if (preloaded === undefined) {
      throw new Error(`Cached entity ${key} not found in preloaded map`);
    }

    obj = preloaded;
  }

  const parsedData: Record<string | symbol, unknown> = {};
  // For symbol id fields (QUERY_ID), copy the id onto parsedData so
  // getOrCreateEntity can read it. entries(shape) skips symbol keys.
  if (typeof entityShape.idField === 'symbol') {
    parsedData[entityShape.idField] = id;
  }
  // For mutation events updating existing entities, track which keys are
  // present so mergeFields only touches those fields (true partial update).
  const existingInStore = queryClient.entityMap.getEntity(key);
  const isPartial = ctx.isPartialEvent && existingInStore !== undefined;

  const entry: ParsedEntity = {
    key,
    shape: entityShape,
    data: parsedData,
    rawKeys: isPartial ? new Set(Object.keys(obj)) : undefined,
  };
  ctx.seen!.set(parsedData, entry);
  ctx.seenByKey!.set(key, entry);

  const entityDesc = `[[${entityShape.typenameValue}:${id}]]`;
  const shape = entityShape.shape;

  for (const [fieldKey, propShape] of entries(shape)) {
    // For partial event updates (mutation events), skip fields not in the payload.
    if (isPartial && !(fieldKey in obj)) continue;
    // For full responses (queries/mutations), always parse every field —
    // missing fields are treated as undefined (JSON drops undefined values).
    parsedData[fieldKey] = parseData(obj[fieldKey], propShape as unknown as TypeDef, ctx, `${entityDesc}.${fieldKey}`);
  }

  return parsedData;
}

// ======================================================
// entitySatisfiesShape
// ======================================================

export function entitySatisfiesShape(data: Record<string, unknown>, def: ValidatorDef<any>): boolean {
  return objectSatisfiesShape(data, def.shape as Record<string, unknown>, def.typenameField);
}

function objectSatisfiesShape(
  data: Record<string, unknown>,
  shape: Record<string, unknown> | undefined,
  typenameField?: string,
): boolean {
  if (shape === undefined) return true;

  for (const key of Object.keys(shape)) {
    if (key === typenameField) continue;

    const fieldDef = shape[key];

    if (fieldDef instanceof ValidatorDef) {
      if ((fieldDef.mask & Mask.UNDEFINED) !== 0) continue;
      if (!(key in data) || data[key] === undefined) return false;
    } else if (typeof fieldDef === 'number') {
      if ((fieldDef & Mask.UNDEFINED) !== 0) continue;
      if (!(key in data) || data[key] === undefined) return false;
    } else {
      if (!(key in data) || data[key] === undefined) return false;
    }
  }
  return true;
}
