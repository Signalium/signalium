/**
 * Query Client with Entity Caching and Deduplication
 *
 * Features:
 * - Global entity map for deduplication
 * - Entity definitions with cached sub-entity paths
 * - Eager entity discovery and caching
 * - Permanent proxy cache for entities
 * - Response caching for offline access
 * - Signalium-based reactivity for entity updates
 * - Self-contained validator (no external dependencies except Signalium)
 */

import {
  reactive,
  signal,
  Signal,
  relay,
  type RelayState,
  context,
  getContext,
  DiscriminatedReactivePromise,
  type Context,
} from 'signalium';
import { NormalizedDocumentStore, PersistentStore } from './documentStore.js';
import { hashValue } from 'signalium/utils';
import { LRUQueue } from './lruQueue.js';
import { createPathInterpolator } from './pathInterpolator.js';

// -----------------------------------------------------------------------------
// Masks and Builder Types
// -----------------------------------------------------------------------------

const isArray = Array.isArray;
const entries = Object.entries;

const enum Mask {
  // Fundamental types
  UNDEFINED = 1 << 0,
  NULL = 1 << 1,
  NUMBER = 1 << 2,
  STRING = 1 << 3,
  BOOLEAN = 1 << 4,
  OBJECT = 1 << 5,
  ARRAY = 1 << 6,

  // Complex types
  RECORD = 1 << 7,
  UNION = 1 << 8,
  ENTITY = 1 << 9,

  // Flags
  HAS_SUB_ENTITY = 1 << 10,
  HAS_NUMBER_FORMAT = 1 << 11,
  HAS_STRING_FORMAT = 1 << 12,
}

// type MaskNumber = number;

type SimpleTypeDef =
  // Strings and booleans are direct constant values
  | string
  | boolean

  // Symbols are numeric constants (linked via symbol-to-constant map)
  | symbol

  // Numbers are primitive type masks (potentially multiple masks combined)
  | Mask;

type ComplexTypeDef =
  // Objects, arrays, records, and unions are definitions
  ObjectDef | EntityDef | ArrayDef | RecordDef | UnionDef;

export type TypeDef = SimpleTypeDef | ComplexTypeDef;

type ShapeDef = number | ComplexTypeDef;

export type ObjectShape = Record<string, TypeDef>;

type MaybeTyped = {
  __typename?: string;
};

class ValidatorDef<T> {
  private _optional: ValidatorDef<T | undefined> | undefined;
  private _nullable: ValidatorDef<T | null> | undefined;
  private _nullish: ValidatorDef<T | null | undefined> | undefined;

  constructor(
    public mask: Mask,
    public shape: TypeDef | ObjectShape | (() => ObjectShape) | UnionTypeDefs | undefined,
    public typename: string | undefined,
    public subEntityPaths: undefined | string | string[],
    public values: (string | boolean | number)[] | undefined = undefined,
  ) {}

  get optional(): ValidatorDef<T | undefined> {
    if (this._optional === undefined) {
      this._optional = new ValidatorDef(
        this.mask | Mask.UNDEFINED,
        this.shape,
        this.typename,
        this.subEntityPaths,
        this.values,
      );
    }
    return this._optional;
  }

  get nullable(): ValidatorDef<T | null> {
    if (this._nullable === undefined) {
      this._nullable = new ValidatorDef(
        this.mask | Mask.NULL,
        this.shape,
        this.typename,
        this.subEntityPaths,
        this.values,
      );
    }
    return this._nullable;
  }

  get nullish(): ValidatorDef<T | null | undefined> {
    if (this._nullish === undefined) {
      this._nullish = new ValidatorDef(
        this.mask | Mask.UNDEFINED | Mask.NULL,
        this.shape,
        this.typename,
        this.subEntityPaths,
        this.values,
      );
    }
    return this._nullish;
  }
}

export interface EntityDef<T extends ObjectShape = ObjectShape> {
  mask: Mask.ENTITY;
  shape: T | (() => T);
  typename: string;
  subEntityPaths: undefined | string | string[];
  values: (string | boolean | number)[] | undefined;

  optional: EntityDef<T> | Mask.UNDEFINED;
  nullable: EntityDef<T> | Mask.NULL;
  nullish: EntityDef<T> | Mask.UNDEFINED | Mask.NULL;
}

export interface ObjectDef<T extends ObjectShape = ObjectShape> {
  mask: Mask.OBJECT;
  shape: T;
  typename: string | undefined;
  subEntityPaths: undefined | string | string[];
  values: (string | boolean | number)[] | undefined;

  optional: ObjectDef<T> | Mask.UNDEFINED;
  nullable: ObjectDef<T> | Mask.NULL;
  nullish: ObjectDef<T> | Mask.UNDEFINED | Mask.NULL;
}

export interface ArrayDef<T extends TypeDef = TypeDef> {
  mask: Mask.ARRAY;
  shape: T;
  values: (string | boolean | number)[] | undefined;

  optional: ArrayDef<T> | Mask.UNDEFINED;
  nullable: ArrayDef<T> | Mask.NULL;
  nullish: ArrayDef<T> | Mask.UNDEFINED | Mask.NULL;
}

export interface UnionDef<_T extends readonly TypeDef[] = readonly TypeDef[]> {
  mask: Mask.UNION;
  shape: UnionTypeDefs | undefined;
  values: (string | boolean | number)[] | undefined;

  optional: UnionDef<_T> | Mask.UNDEFINED;
  nullable: UnionDef<_T> | Mask.NULL;
  nullish: UnionDef<_T> | Mask.UNDEFINED | Mask.NULL;
}

export interface RecordDef<T extends TypeDef = TypeDef> {
  mask: Mask.RECORD;
  shape: T;
  values: (string | boolean | number)[] | undefined;

  optional: RecordDef<T> | Mask.UNDEFINED;
  nullable: RecordDef<T> | Mask.NULL;
  nullish: RecordDef<T> | Mask.UNDEFINED | Mask.NULL;
}

// -----------------------------------------------------------------------------
// Shape Definitions
// -----------------------------------------------------------------------------

function extractSubEntityPaths(shape: ObjectShape): undefined | string | string[] {
  let subEntityPaths: undefined | string | string[];

  for (const [key, value] of entries(shape)) {
    if (typeof value === 'object' && (value.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
      if (subEntityPaths === undefined) {
        subEntityPaths = key;
      } else if (isArray(subEntityPaths)) {
        subEntityPaths.push(key);
      } else {
        subEntityPaths = [subEntityPaths, key];
      }
    }
  }

  return subEntityPaths;
}

const NUM_CONST_SYMBOL_MAP = new Map<number, symbol>();
const SYMBOL_NUM_CONST_MAP = new Map<symbol, number>();

function defineConst<T extends string | boolean | number>(value: T): T extends number ? symbol : T {
  if (typeof value !== 'number') {
    return value as T extends number ? symbol : T;
  }

  let symbol = NUM_CONST_SYMBOL_MAP.get(value);

  if (symbol === undefined) {
    symbol = Symbol();
    NUM_CONST_SYMBOL_MAP.set(value, symbol);
    SYMBOL_NUM_CONST_MAP.set(symbol, value);
  }

  return symbol as T extends number ? symbol : T;
}

function defineArray<T extends TypeDef>(shape: T): ArrayDef<T> {
  let mask = Mask.ARRAY;

  // Propagate HAS_SUB_ENTITY flag if the shape contains entities
  if (typeof shape === 'object' && (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
    mask |= Mask.HAS_SUB_ENTITY;
  }

  return new ValidatorDef(mask, shape, undefined, undefined) as unknown as ArrayDef<T>;
}

function defineRecord<T extends TypeDef>(shape: T): RecordDef<T> {
  // The mask should be OBJECT | RECORD so that values match when compared
  let mask = Mask.RECORD | Mask.OBJECT;

  // Propagate HAS_SUB_ENTITY flag if the shape contains entities
  if (typeof shape === 'object' && (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
    mask |= Mask.HAS_SUB_ENTITY;
  }

  return new ValidatorDef(mask, shape, undefined, undefined) as unknown as RecordDef<T>;
}

function defineObject<T extends ObjectShape>(shape: T): ObjectDef<T> {
  return new ValidatorDef(Mask.OBJECT, shape, undefined, extractSubEntityPaths(shape)) as unknown as ObjectDef<T>;
}

const ARRAY_KEY = Symbol('array');
const RECORD_KEY = Symbol('record');

interface UnionTypeDefs {
  [ARRAY_KEY]?: ShapeDef;
  [RECORD_KEY]?: ShapeDef;
  [key: string]: ObjectDef | EntityDef;
}

const addShapeToUnion = (shape: UnionTypeDefs, definition: ObjectDef | EntityDef | RecordDef | UnionDef | ArrayDef) => {
  const mask = definition.mask;

  if ((mask & Mask.ARRAY) !== 0) {
    if (shape[ARRAY_KEY] !== undefined) {
      throw new Error('Array shape already defined');
    }

    shape[ARRAY_KEY] = definition.shape as ShapeDef;
  } else if ((mask & Mask.RECORD) !== 0) {
    if (shape[RECORD_KEY] !== undefined) {
      throw new Error('Record shape already defined');
    }

    shape[RECORD_KEY] = definition.shape as ShapeDef;
  } else {
    // definition is ObjectDef | EntityDef
    const typename = (definition as ObjectDef).typename;

    if (typename === undefined) {
      throw new Error(
        'Object definitions must have a typename to be in a union with other objects, records, or arrays',
      );
    }

    shape[typename] = definition as ObjectDef;
  }
};

function defineUnion<T extends readonly TypeDef[]>(...types: T): UnionDef<T> {
  let mask = 0;
  let definition: ObjectDef | EntityDef | RecordDef | UnionDef | ArrayDef | undefined;
  let shape: UnionTypeDefs | undefined;
  let values: (string | boolean | number)[] | undefined;

  for (const type of types) {
    switch (typeof type) {
      case 'object':
        mask |= type.mask;

        if (type.values !== undefined) {
          if (values === undefined) {
            values = type.values.slice();
          } else {
            values = values.concat(type.values);
          }
          values = values?.concat(type.values) ?? type.values.slice();
        }

        if (definition === undefined) {
          definition = type;
          break;
        }

        if (shape === undefined) {
          shape = Object.create(null) as UnionTypeDefs;

          addShapeToUnion(shape, definition);
        }

        addShapeToUnion(shape, type);
        break;

      case 'symbol': {
        if (values === undefined) {
          values = [SYMBOL_NUM_CONST_MAP.get(type)!];
        } else {
          values.push(SYMBOL_NUM_CONST_MAP.get(type)!);
        }
        break;
      }

      case 'string':
      case 'boolean':
        if (values === undefined) {
          values = [type];
        } else {
          values.push(type);
        }
        break;

      default:
        mask |= type;
        break;
    }
  }

  // It was a union of primitives, so return the mask
  if (definition === undefined && values === undefined) {
    // This type coercion is incorrect, but we can't return the mask as a Mask
    // because that loses the type information about the union, which breaks
    // inference.
    //
    // TODO: Figure out how to make this correct type-wise
    return mask as unknown as UnionDef<T>;
  }

  return new ValidatorDef(mask, shape ?? definition?.shape, undefined, undefined, values) as UnionDef;
}

export function extractShape<T extends ObjectDef | EntityDef | ArrayDef | RecordDef | UnionDef>(
  def: T,
): T extends EntityDef ? ObjectShape : T['shape'] {
  let shape = def.shape;

  if (typeof shape === 'function') {
    shape = def.shape = shape();
    (def as EntityDef).subEntityPaths = extractSubEntityPaths(shape);
  }

  return shape as T extends EntityDef ? ObjectShape : T['shape'];
}

export function entity<T extends ObjectShape>(typename: string, shape: () => T): EntityDef<T> {
  return new ValidatorDef(
    // The mask should be OBJECT | ENTITY so that values match when compared
    Mask.ENTITY | Mask.OBJECT,
    shape,
    typename,
    undefined,
  ) as unknown as EntityDef<T>;
}

// -----------------------------------------------------------------------------
// Formatted Values
// -----------------------------------------------------------------------------

const FORMAT_MASK_SHIFT = 16;

let nextFormatId = 0;
const FORMAT_PARSERS: ((value: unknown) => unknown)[] = [];
const FORMAT_SERIALIZERS: ((value: unknown) => unknown)[] = [];
const FORMAT_MAP = new Map<string, number>();

function defineFormatted(format: string): number {
  const mask = FORMAT_MAP.get(format);

  if (mask === undefined) {
    throw new Error(`Format ${format} not registered`);
  }

  return mask;
}

function getFormat(mask: number): (value: unknown) => unknown {
  const formatId = mask >> FORMAT_MASK_SHIFT;

  return FORMAT_PARSERS[formatId];
}

export function registerFormat<Input extends string | boolean, T>(
  name: string,
  type: Input extends string ? Mask.STRING : Mask.BOOLEAN,
  parse: (value: Input) => T,
  serialize: (value: T) => Input,
) {
  const maskId = nextFormatId++;
  FORMAT_PARSERS[maskId] = parse as (value: unknown) => unknown;
  FORMAT_SERIALIZERS[maskId] = serialize as (value: unknown) => unknown;

  const shiftedId = maskId << FORMAT_MASK_SHIFT;
  const formatMask = type === Mask.STRING ? Mask.HAS_STRING_FORMAT : Mask.HAS_NUMBER_FORMAT;
  const mask = shiftedId | type | formatMask;

  FORMAT_MAP.set(name, mask);
}

// -----------------------------------------------------------------------------
// Proxies
// -----------------------------------------------------------------------------

function parseUnionValue(
  valueType: number,
  value: Record<string, unknown> | unknown[],
  unionDef: UnionDef,
  path: string,
): unknown {
  if (valueType === Mask.ARRAY) {
    const shape = unionDef.shape![ARRAY_KEY];

    if (shape === undefined || typeof shape === 'number') {
      return value;
    }

    return parseArrayValue(value as unknown[], shape, path);
  } else {
    const typename = (value as MaybeTyped)['__typename'];

    if (typename === undefined) {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        return value;
      }

      return parseRecordValue(value as Record<string, unknown>, recordShape as ComplexTypeDef, path);
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      return value;
    }

    return parseObjectValue(value as Record<string, unknown>, matchingDef as ObjectDef | EntityDef, path);
  }
}

export function parseArrayValue(array: unknown[], arrayShape: ComplexTypeDef, path: string) {
  for (let i = 0; i < array.length; i++) {
    array[i] = parseValue(array[i], arrayShape, `${path}[${i}]`);
  }

  return array;
}

export function parseRecordValue(record: Record<string, unknown>, recordShape: ComplexTypeDef, path: string) {
  for (const [key, value] of entries(record)) {
    record[key] = parseValue(value, recordShape, `${path}["${key}"]`);
  }

  return record;
}

export function parseObjectValue(object: Record<string, unknown>, objectShape: ObjectDef | EntityDef, path: string) {
  if (PROXY_BRAND.has(object)) {
    // Is an entity proxy, so return it directly
    return object;
  }

  const shape = extractShape(objectShape);

  for (const [key, propShape] of entries(shape)) {
    // parse and replace the property in place
    object[key] = parseValue(object[key], propShape, `${path}.${key}`);
  }

  return object;
}

export function parseValue(value: unknown, propDef: TypeDef, path: string): unknown {
  switch (typeof propDef) {
    case 'symbol':
      // update propDef to be the constant number value, then drop through
      // standard constant value handling
      propDef = SYMBOL_NUM_CONST_MAP.get(propDef as symbol)!;

    // handle constants
    // eslint-disable-next-line no-fallthrough
    case 'string':
    case 'boolean':
      if (value !== propDef) {
        throw typeError(path, propDef, value);
      }

      return value;

    // handle primitives
    case 'number': {
      let valueType = typeMaskOf(value);

      if ((propDef & valueType) === 0) {
        throw typeError(path, propDef, value);
      }

      if ((propDef & Mask.HAS_NUMBER_FORMAT) !== 0 && valueType === Mask.NUMBER) {
        return getFormat(propDef)(value);
      }

      if ((propDef & Mask.HAS_STRING_FORMAT) !== 0 && valueType === Mask.STRING) {
        return getFormat(propDef)(value);
      }
      return value;
    }

    // handle complex objects
    default: {
      // Note: Keep in mind that at this point, we're using `valueType`
      // primarily, so some of the logic is "reversed" from the above where
      // we use the `propDef` type primarily
      let valueType = typeMaskOf(value);
      const propMask = propDef.mask;

      // Check if the value type is allowed by the propMask
      if ((propMask & valueType) === 0 && propDef.values?.includes(value as string | boolean | number) !== true) {
        throw typeError(path, propMask, value);
      }

      if (valueType < Mask.OBJECT) {
        if ((propMask & Mask.HAS_NUMBER_FORMAT) !== 0 && valueType === Mask.NUMBER) {
          return getFormat(propMask)(value);
        }

        if ((propMask & Mask.HAS_STRING_FORMAT) !== 0 && valueType === Mask.STRING) {
          return getFormat(propMask)(value);
        }

        // value is a primitive, it has already passed the mask so return it now
        return value;
      }

      if ((valueType & Mask.UNION) !== 0) {
        return parseUnionValue(valueType, value as Record<string, unknown> | unknown[], propDef as UnionDef, path);
      }

      if (valueType === Mask.ARRAY) {
        return parseArrayValue(value as unknown[], propDef as ArrayDef | UnionDef, path);
      }

      return parseObjectValue(value as Record<string, unknown>, propDef as ObjectDef | EntityDef, path);
    }
  }
}

export interface EntityRecord {
  key: number;
  signal: Signal<Record<string, unknown>>;
  cache: Map<PropertyKey, any>;
  proxy: Record<string, unknown>;
}

export function createEntityProxy(
  id: number,
  desc: string,
  init: Record<string, unknown>,
  def: ObjectDef | EntityDef,
): EntityRecord {
  // Cache for nested proxies - each proxy gets its own cache
  const shape = extractShape(def);

  const toJSON = () => ({
    __entityRef: id,
  });

  const handler: ProxyHandler<any> = {
    get(target, prop) {
      // Handle toJSON for serialization
      if (prop === 'toJSON') {
        return toJSON;
      }

      const { signal, cache } = entityRecord;
      const obj = signal.value;

      // Check cache first, BEFORE any expensive checks
      if (cache.has(prop)) {
        return cache.get(prop);
      }

      let value = obj[prop as string];
      let propDef = shape[prop as string];

      if (!Object.hasOwnProperty.call(shape, prop)) {
        return value;
      }

      const parsed = parseValue(value, propDef, `[[${desc}]].${prop as string}`);

      cache.set(prop, parsed);

      return parsed;
    },

    has(target, prop) {
      return prop in shape;
    },
  };

  const proxy = new Proxy({}, handler);

  // Add the proxy to the proxy brand set so we can easily identify it later
  PROXY_BRAND.add(proxy);

  const entityRecord: EntityRecord = {
    key: id,
    signal: signal(init),
    cache: new Map(),
    proxy,
  };

  return entityRecord;
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

function typeMaskOf(value: unknown): Mask {
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

function typeToString(type: TypeDef): string {
  // TODO: Implement
  return 'todo';
}

function typeError(path: string, expectedType: TypeDef, value: unknown): Error {
  return new TypeError(
    `Validation error at ${path}: expected ${typeToString(expectedType)}, got ${
      typeof value === 'object' ? (value === null ? 'null' : isArray(value) ? 'array' : 'object') : typeof value
    }`,
  );
}

// -----------------------------------------------------------------------------
// Entity System
// -----------------------------------------------------------------------------

const PROXY_BRAND = new WeakSet();

export async function parseUnionEntities(
  valueType: number,
  value: object | unknown[],
  unionDef: UnionDef,
  queryClient: QueryClient,
  entityRefs: number[],
): Promise<unknown> {
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
    const typename = (value as MaybeTyped)['__typename'];

    if (typename === undefined) {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        return value;
      }

      return parseRecordEntities(value as Record<string, unknown>, recordShape, queryClient, entityRefs);
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

export async function parseArrayEntities(
  array: unknown[],
  arrayShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs: number[],
): Promise<unknown[]> {
  for (let i = 0; i < array.length; i++) {
    array[i] = await parseEntities(array[i], arrayShape, queryClient, entityRefs);
  }

  return array;
}

export async function parseRecordEntities(
  record: Record<string, unknown>,
  recordShape: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs: number[],
): Promise<Record<string, unknown>> {
  if (typeof recordShape === 'number') {
    return record;
  }

  for (const [key, value] of entries(record)) {
    record[key] = await parseEntities(value, recordShape, queryClient, entityRefs);
  }

  return record;
}

export async function parseObjectEntities(
  object: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  queryClient: QueryClient,
  entityRefs: number[],
): Promise<Record<string, unknown>> {
  const entityRefId = object.__entityRef as number;

  // Check if this is an entity reference (from cache)
  if (typeof entityRefId === 'number') {
    // Try to load from memory first
    const entityMap = queryClient.getEntityMap();
    let record = entityMap.get(entityRefId);
    if (record) {
      return record.proxy;
    }

    // Load from document store and parse
    return queryClient.loadEntityFromRef(entityRefId, objectShape as EntityDef);
  }

  // Process sub-entity paths (only these paths can contain entities)
  const { mask } = objectShape;

  const childRefs = mask & Mask.ENTITY ? [] : entityRefs;

  // Extract shape first to resolve lazy definitions and set subEntityPaths
  const shape = extractShape(objectShape);
  const subEntityPaths = objectShape.subEntityPaths;

  if (subEntityPaths !== undefined) {
    if (typeof subEntityPaths === 'string') {
      // Single path - avoid array allocation
      const propDef = shape[subEntityPaths];
      object[subEntityPaths] = await parseEntities(
        object[subEntityPaths],
        propDef as ComplexTypeDef,
        queryClient,
        childRefs,
      );
    } else {
      // Multiple paths - iterate directly
      for (const path of subEntityPaths) {
        const propDef = shape[path];
        object[path] = await parseEntities(object[path], propDef as ComplexTypeDef, queryClient, childRefs);
      }
    }
  }

  // Handle entity replacement (entities get cached and replaced with proxies)
  if (mask & Mask.ENTITY) {
    const typename = objectShape.typename;
    const id = object.id;

    const desc = `${typename}:${id}`;
    const key = hashValue(desc);

    await queryClient.documentStore.set(key, object, childRefs.length > 0 ? new Uint32Array(childRefs) : undefined);

    // Only push if not already in entityRefs (deduplicate)
    if (!entityRefs.includes(key)) {
      entityRefs.push(key);
    }

    const entityMap = queryClient.getEntityMap();
    let record = entityMap.get(key);

    if (record === undefined) {
      record = createEntityProxy(key, desc, object, objectShape);

      entityMap.set(key, record);
    }

    return record.proxy;
  }

  // Return the processed object (even if not an entity)
  return object;
}

export async function parseEntities(
  value: unknown,
  def: ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs: number[],
): Promise<unknown> {
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

// -----------------------------------------------------------------------------
// Query Definition and Client
// -----------------------------------------------------------------------------

export interface QueryContext {
  fetch: typeof fetch;
}

export interface QueryDefinition<Params, Result> {
  id: string;
  shape: TypeDef;
  fetchFn: (context: QueryContext, params: Params) => Promise<Result>;

  staleTime?: number;
  refetchInterval?: number;

  cache?: {
    maxCount?: number;
    maxPersistentCount?: number;
  };
}

interface QueryInstance<T> {
  relay: DiscriminatedReactivePromise<T>;
  active: boolean;
  initialized: boolean;
}

interface QueryInstanceMeta {
  updatedAt: number;
}

const queryKeyFor = (queryDef: QueryDefinition<any, any>, params: unknown): number => {
  return hashValue([queryDef.id, params]);
};

const queryLRUKeyFor = (queryDef: QueryDefinition<any, any>): string => {
  return `queryLRU:${queryDef.id}`;
};

const DEFAULT_QUERY_LRU_SIZE = 100;
const LRU_QUEUE_GROW_FACTOR = 1.5;

export class QueryClient {
  private entityMap = new Map<number, EntityRecord>();
  private queryInstances = new Map<number, QueryInstance<unknown>>();
  private queryInstanceMeta = new Map<number, QueryInstanceMeta>();
  private queryLRUQueues = new Map<string, LRUQueue>();

  constructor(
    public kv: PersistentStore,
    public documentStore: NormalizedDocumentStore,
    private context: QueryContext = { fetch },
  ) {}

  /**
   * Loads a query from the document store and returns a Signalium Relay
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    params: Params,
  ): DiscriminatedReactivePromise<Result> {
    const queryKey = queryKeyFor(queryDef, params);

    let queryInstance = this.queryInstances.get(queryKey);

    // Create a new relay if it doesn't exist
    if (queryInstance === undefined) {
      const queryRelay = relay<Result>(state => {
        queryInstance!.active = true;

        // Load from cache first, then fetch fresh data
        this.executeQuery(queryDef, params, state as RelayState<unknown>, queryInstance as QueryInstance<Result>);

        // Return cleanup function
        return () => {
          // Move query from active to inactive segment
          this.deactivateQuery(queryDef, queryKey, queryInstance!);
        };
      });

      queryInstance = {
        relay: queryRelay,
        active: false,
        initialized: false,
      };

      // Store the relay for future use
      this.queryInstances.set(queryKey, queryInstance);
    }

    return queryInstance.relay as DiscriminatedReactivePromise<Result>;
  }

  /**
   * Executes a query by loading from cache and optionally fetching fresh data
   */
  private async executeQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    params: Params,
    state: RelayState<unknown>,
    instance: QueryInstance<Result>,
  ): Promise<void> {
    try {
      const queryKey = queryKeyFor(queryDef, params);

      if (!instance.initialized) {
        instance.initialized = true;

        // Load from cache first
        const query = await this.documentStore.get(queryKey);

        if (query !== undefined) {
          const shape = queryDef.shape;
          state.value =
            typeof shape === 'object' ? parseEntities(query, shape, this, []) : parseValue(query, shape, queryDef.id);
        }
      }

      this.activateQuery(queryDef, queryKey, instance);

      // TODO: Add stale time check here
      // Then fetch fresh data if needed
      state.setPromise(this.runQuery(queryDef, params));
    } catch (error) {
      // Relay will handle the error state automatically
      state.setError(error as Error);
    }
  }

  /**
   * Activates a query and adds it to the LRU queue.
   */
  private async activateQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    queryKey: number,
    instance: QueryInstance<Result>,
  ): Promise<void> {
    instance.active = true;

    const lruQueue = await this.getQueryLRUQueue(queryDef);
    const evictedKey = lruQueue.activate(queryKey, LRU_QUEUE_GROW_FACTOR);

    // Handle eviction if needed
    if (evictedKey !== null) {
      await this.removeQuery(evictedKey);
    }

    // Persist the updated queue to storage
    await this.kv.setBuffer(queryLRUKeyFor(queryDef), lruQueue.queue);
  }

  /**
   * Deactivates a query and moves it from the active segment to the inactive segment.
   */
  private async deactivateQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    queryKey: number,
    instance: QueryInstance<Result>,
  ): Promise<void> {
    instance.active = false;

    const lruQueue = await this.getQueryLRUQueue(queryDef);
    lruQueue.deactivate(queryKey);

    // Persist the updated queue to storage
    await this.kv.setBuffer(queryLRUKeyFor(queryDef), lruQueue.queue);
  }

  private async removeQuery(queryKey: number): Promise<void> {
    this.queryInstances.delete(queryKey);
    await this.documentStore.delete(queryKey);
  }

  private async getQueryLRUQueue<Params, Result>(queryDef: QueryDefinition<Params, Result>): Promise<LRUQueue> {
    const id = queryDef.id;

    let lruQueue = this.queryLRUQueues.get(id);

    if (lruQueue === undefined) {
      const queueArray = await this.kv.getBuffer(queryLRUKeyFor(queryDef));

      // Create LRUQueue with either loaded data or new array
      lruQueue = new LRUQueue(DEFAULT_QUERY_LRU_SIZE, queueArray);

      this.queryLRUQueues.set(id, lruQueue);
    }

    return lruQueue;
  }

  /**
   * Recursively loads nested queries from the document store
   */
  private async loadEntityFromCache<T>(refId: number, shape: EntityDef): Promise<EntityRecord | undefined> {
    const entity = await this.documentStore.get(refId);

    if (entity === undefined) {
      return;
    }

    const proxy = await parseEntities(entity, shape, this, []);

    const entityRecord: EntityRecord = {
      key: refId,
      signal: signal(entity as Record<string, unknown>),
      cache: new Map(),
      proxy: proxy as Record<string, unknown>,
    };

    this.entityMap.set(refId, entityRecord);

    return entityRecord;
  }

  /**
   * Fetches fresh data and updates the cache
   */
  private async runQuery<Params, Result>(queryDef: QueryDefinition<Params, Result>, params: Params): Promise<Result> {
    const freshData = await queryDef.fetchFn(this.context, params);

    // Parse and cache the fresh data
    const entityRefs: number[] = [];

    const shape = queryDef.shape;

    const parsedData =
      typeof shape === 'object'
        ? parseEntities(freshData, shape, this, entityRefs)
        : parseValue(freshData, shape, queryDef.id);

    // Cache the data
    const queryKey = queryKeyFor(queryDef, params);
    await this.documentStore.set(queryKey, freshData, new Uint32Array(entityRefs));

    return parsedData as Result;
  }

  /**
   * Gets the current entity map for inspection
   */
  getEntityMap(): Map<number, EntityRecord> {
    return this.entityMap;
  }

  /**
   * Loads an entity from its reference key and creates a proxy
   * This is called synchronously during parsing, so we return a placeholder
   * The actual loading will be handled asynchronously by the QueryClient
   */
  async loadEntityFromRef(entityRef: number, shape: EntityDef): Promise<Record<string, unknown>> {
    // Check if we already have this entity in memory
    const record = this.entityMap.get(entityRef) ?? (await this.loadEntityFromCache(entityRef, shape));

    if (record === undefined) {
      throw new Error(`Entity ${entityRef} not found`);
    }

    return record.proxy;
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);

type ExtractPrimitiveTypeFromMask<T extends number> = T extends Mask.UNDEFINED
  ? undefined
  : T extends Mask.NULL
    ? null
    : T extends Mask.NUMBER
      ? number
      : T extends Mask.STRING
        ? string
        : T extends Mask.BOOLEAN
          ? boolean
          : never;

export type ExtractType<T extends TypeDef> = T extends number
  ? ExtractPrimitiveTypeFromMask<T>
  : T extends symbol | string | boolean
    ? T
    : T extends ObjectDef<infer S>
      ? Prettify<ExtractTypesFromShape<S>>
      : T extends EntityDef<infer S>
        ? Prettify<ExtractTypesFromShape<S>>
        : T extends ArrayDef<infer S>
          ? ExtractType<S>[]
          : T extends RecordDef<infer S>
            ? Record<string, ExtractType<S>>
            : T extends UnionDef<infer VS>
              ? ExtractType<VS[number]>
              : never;

type ExtractTypesFromShape<S extends Record<string, TypeDef>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

type IsParameter<Part> = Part extends `[${infer ParamName}]` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;
type ParamValue<Key> = Key extends `...${infer Anything}` ? (string | number)[] : string | number;
type RemovePrefixDots<Key> = Key extends `...${infer Name}` ? Name : Key;
type PathParams<Path> = {
  [Key in FilteredParts<Path> as RemovePrefixDots<Key>]: ParamValue<Key>;
};

interface RESTQueryDefinition {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  searchParams?: Record<string, TypeDef>;
  response: Record<string, TypeDef> | TypeDef;
}

interface APITypes {
  const: <T extends string | boolean | number>(value: T) => T extends number ? symbol : T;
  format: (format: string) => number;
  string: Mask.STRING;
  number: Mask.NUMBER;
  boolean: Mask.BOOLEAN;
  null: Mask.NULL;
  undefined: Mask.UNDEFINED;

  array: <T extends TypeDef>(shape: T) => ArrayDef<T>;

  object: <T extends ObjectShape>(shape: T) => ObjectDef<T>;
  record: <T extends TypeDef>(shape: T) => RecordDef<T>;

  union: <VS extends readonly TypeDef[]>(...types: VS) => UnionDef<VS>;
}

export const t: APITypes = {
  const: defineConst,
  format: defineFormatted,
  string: Mask.STRING,
  number: Mask.NUMBER,
  boolean: Mask.BOOLEAN,
  null: Mask.NULL,
  undefined: Mask.UNDEFINED,
  array: defineArray,
  object: defineObject,
  record: defineRecord,
  union: defineUnion,
};

type ExtractTypesFromObjectOrTypeDef<S extends Record<string, TypeDef> | TypeDef | undefined> =
  S extends Record<string, TypeDef>
    ? {
        [K in keyof S]: ExtractType<S[K]>;
      }
    : S extends TypeDef
      ? ExtractType<S>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

type QueryParams<QDef extends RESTQueryDefinition> = PathParams<QDef['path']> &
  ExtractTypesFromObjectOrTypeDef<QDef['searchParams']>;

type QueryParamsOrUndefined<QDef extends RESTQueryDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends QueryParams<QDef> ? undefined : QueryParams<QDef>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type HasRequiredKeys<T> = {} extends T ? false : { [K in keyof T]: undefined } extends T ? false : true;

type Optionalize<T> = T extends object
  ? {
      -readonly [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    } & {
      -readonly [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
    }
  : T;

type Prettify<T> = T extends object
  ? {
      -readonly [K in keyof T]: T[K];
    } & {}
  : T;

export function query<const QDef extends RESTQueryDefinition>(
  queryDefinitionBuilder: (t: APITypes) => QDef,
): (
  ...args: HasRequiredKeys<QueryParams<QDef>> extends true
    ? [params: Prettify<Optionalize<QueryParams<QDef>>>]
    : [params?: Prettify<Optionalize<QueryParamsOrUndefined<QDef>>>]
) => DiscriminatedReactivePromise<Readonly<Prettify<ExtractTypesFromObjectOrTypeDef<QDef['response']>>>> {
  let queryDefinition:
    | QueryDefinition<Record<string, unknown>, ExtractTypesFromObjectOrTypeDef<QDef['response']>>
    | undefined;

  return reactive(
    (
      params: Record<string, unknown>,
    ): DiscriminatedReactivePromise<ExtractTypesFromObjectOrTypeDef<QDef['response']>> => {
      const queryClient = getContext(QueryClientContext);

      if (queryClient === undefined) {
        throw new Error('QueryClient not found');
      }

      if (queryDefinition === undefined) {
        const { path, method = 'GET', response } = queryDefinitionBuilder(t);

        const id = `${method}:${path}`;

        const shape: TypeDef =
          typeof response === 'object' && !(response instanceof ValidatorDef)
            ? t.object(response as Record<string, TypeDef>)
            : (response as TypeDef);

        // Create optimized path interpolator (parses template once)
        const interpolatePath = createPathInterpolator(path);

        const fetchFn = async (context: QueryContext, params: Record<string, unknown>) => {
          // Interpolate path params and append search params automatically
          const url = interpolatePath(params);

          const response = await context.fetch(url, {
            method,
          });

          return response.json();
        };

        queryDefinition = {
          id,
          shape,
          fetchFn,
        };
      }

      return queryClient.getQuery(queryDefinition, params);
    },
    // TODO: Getting a lot of type errors due to infinite recursion here.
    // For now, we return as any to coerce to the external type signature,
    // and internally we manage the difference.
  ) as any;
}
