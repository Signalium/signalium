import {
  APITypes,
  ARRAY_KEY,
  ComplexTypeDef,
  EntityConfig,
  EntityMethods,
  ExtractType,
  ExtractTypesFromShape,
  InternalTypeDef,
  InternalObjectShape,
  Mask,
  ObjectDef,
  RECORD_KEY,
  TypeDef,
  UnionDef,
  UnionTypeDefs,
} from './types.js';
import { Prettify } from './type-utils.js';
import { hashValue } from 'signalium/utils';

const entries = Object.entries;
const isArray = Array.isArray;

export class ValidatorDef<T> {
  public mask: Mask;
  public shapeKey: number;
  public shape: InternalTypeDef | InternalObjectShape | UnionTypeDefs | ComplexTypeDef[] | undefined;
  public subEntityPaths: undefined | string | string[] = undefined;
  public typenameField: string | undefined = undefined;
  public typenameValue: string | undefined = undefined;
  public idField: string | undefined = undefined;
  public values: Set<string | boolean | number> | undefined = undefined;

  /**
   * Methods object for entity definitions.
   * Shared across all proxies, but each proxy binds its own reactive method wrappers.
   */
  public _methods: EntityMethods | undefined = undefined;

  /**
   * Entity configuration including stream options.
   */
  public _entityConfig: EntityConfig<any> | undefined = undefined;

  /**
   * The original Entity class for this definition.
   * Used by createEntityProxy to set the proxy prototype so `instanceof` works.
   */
  public _entityClass: (new () => any) | undefined = undefined;

  /**
   * Entity cache options (e.g. gcTime for in-memory eviction).
   */
  public _entityCache: { gcTime?: number } | undefined = undefined;

  constructor(
    mask: Mask,
    shape: InternalTypeDef | InternalObjectShape | UnionTypeDefs | ComplexTypeDef[] | undefined,
    shapeKey: number,
    values: Set<string | boolean | number> | undefined = undefined,
    typenameField: string | undefined = undefined,
    typenameValue: string | undefined = undefined,
    idField: string | undefined = undefined,
    subEntityPaths: undefined | string | string[] = undefined,
  ) {
    this.mask = mask;
    this.shape = shape;
    this.shapeKey = shapeKey;
    this.values = values;
    this.typenameField = typenameField;
    this.typenameValue = typenameValue;
    this.idField = idField;
    this.subEntityPaths = subEntityPaths;
  }

  static cloneWith(def: ValidatorDef<any>, mask: Mask): ValidatorDef<any> {
    const newDef = new ValidatorDef(
      mask | def.mask,
      def.shape,
      def.shapeKey,
      def.values,
      def.typenameField,
      def.typenameValue,
      def.idField,
      def.subEntityPaths,
    );
    newDef._methods = def._methods;
    newDef._entityConfig = def._entityConfig;
    newDef._entityClass = def._entityClass;
    newDef._entityCache = def._entityCache;
    return newDef;
  }
}

// -----------------------------------------------------------------------------
// Case-Insensitive Enum Set
// -----------------------------------------------------------------------------

/**
 * A Set-like class for enum values that matches string values case-insensitively.
 * Non-string values (numbers, booleans) are matched exactly.
 * Returns the canonical (originally defined) casing when a match is found.
 */
export class CaseInsensitiveSet<T extends string | boolean | number> extends Set<T> {
  private readonly lowercaseMap: Map<string, T>; // lowercase -> canonical (strings only)

  constructor(values: readonly T[]) {
    super(values);

    this.lowercaseMap = new Map<string, T>();

    for (const value of values) {
      if (typeof value === 'string') {
        const lowercase = value.toLowerCase();
        const existing = this.lowercaseMap.get(lowercase);

        if (existing !== undefined) {
          throw new Error(
            `Case-insensitive enum cannot have multiple values with the same lowercase form: '${existing}' and '${value}' both become '${lowercase}'`,
          );
        }

        this.lowercaseMap.set(lowercase, value);
      }
    }
  }

  /**
   * Check if a value exists in the set (case-insensitively for strings).
   * Used for backwards compatibility with Set-based checks.
   */
  has(value: unknown): boolean {
    return this.get(value) !== undefined;
  }

  /**
   * Get the canonical value for a given input.
   * For strings, performs case-insensitive lookup and returns the canonical casing.
   * For numbers/booleans, performs exact match.
   * Returns undefined if no match is found.
   */
  get(value: unknown): T | undefined {
    if (typeof value === 'string') {
      return this.lowercaseMap.get(value.toLowerCase());
    }

    if (super.has(value as T)) {
      return value as T;
    }

    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Complex Type Definitions
// -----------------------------------------------------------------------------

function defineWrapperType(kindTag: number, mask: Mask, shape: InternalTypeDef): ValidatorDef<any> {
  let shapeKey;

  if (shape instanceof ValidatorDef) {
    shapeKey = shape.shapeKey;

    if (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) {
      mask |= Mask.HAS_SUB_ENTITY;
    }
  } else if (shape instanceof CaseInsensitiveSet) {
    shapeKey = hashValue(Array.from(shape));
  } else {
    shapeKey = hashValue(shape);
  }

  return new ValidatorDef(mask, shape, hashValue([kindTag, mask, undefined, shapeKey]) >>> 0);
}

export function defineArray<T extends TypeDef>(shape: T): TypeDef<ExtractType<T>[]> {
  return defineWrapperType(0, Mask.ARRAY, shape as unknown as InternalTypeDef) as unknown as TypeDef<ExtractType<T>[]>;
}

export function defineRecord<T extends TypeDef>(shape: T): TypeDef<Record<string, ExtractType<T>>> {
  return defineWrapperType(1, Mask.RECORD | Mask.OBJECT, shape as unknown as InternalTypeDef) as unknown as TypeDef<
    Record<string, ExtractType<T>>
  >;
}

export function defineParseResult<T extends TypeDef>(
  innerType: T,
): TypeDef<import('./types.js').ParseResult<ExtractType<T>>> {
  return defineWrapperType(2, Mask.PARSE_RESULT, innerType as unknown as InternalTypeDef) as unknown as TypeDef<
    import('./types.js').ParseResult<ExtractType<T>>
  >;
}

function defineObjectOrEntity(baseMask: Mask, shape: InternalObjectShape): ValidatorDef<any> {
  // create a hash of the shape, starting with the object mask as the base
  let mask = baseMask;

  let shapeKey = hashValue([mask, undefined]);
  let idField: string | undefined = undefined;
  let typenameField: string | undefined = undefined;
  let typenameValue: string | undefined = undefined;
  let subEntityPaths: undefined | string | string[] = undefined;

  for (const [key, value] of entries(shape)) {
    switch (typeof value) {
      case 'number':
        if ((value & Mask.ID) !== 0) {
          if (idField !== undefined) {
            throw new Error(`Duplicate id field: ${key}`);
          }

          idField = key;
        }

        // Add to shape key (order independent operation)
        shapeKey += hashValue(key) ^ value;
        break;
      case 'string':
        // This is a typename field (plain string value)
        if (typenameField !== undefined && typenameField !== key) {
          throw new Error(`Duplicate typename field: ${key}`);
        }

        typenameField = key;
        typenameValue = value;

        // Add to shape key (order independent operation)
        shapeKey += hashValue(key) ^ hashValue(value);
        break;
      case 'object':
        if (value instanceof CaseInsensitiveSet) {
          shapeKey ^= hashValue(key) ^ hashValue(Array.from(value));
          break;
        }

        if (value instanceof Set) {
          shapeKey ^= hashValue(key) ^ hashValue(value);
          break;
        }

        // Add to shape key (order independent operation)
        shapeKey += hashValue(key) ^ value.shapeKey;

        if (value.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) {
          mask |= Mask.HAS_SUB_ENTITY;
          if (subEntityPaths === undefined) {
            subEntityPaths = key;
          } else if (isArray(subEntityPaths)) {
            subEntityPaths.push(key);
          } else {
            subEntityPaths = [subEntityPaths, key];
          }
        }
        break;
    }
  }

  // Convert to unsigned 32-bit integer
  shapeKey = shapeKey >>> 0;

  return new ValidatorDef(mask, shape, shapeKey, undefined, typenameField, typenameValue, idField, subEntityPaths);
}

export function defineObject<T extends Record<string, TypeDef>>(shape: T): TypeDef<Prettify<ExtractTypesFromShape<T>>> {
  return defineObjectOrEntity(Mask.OBJECT, shape as unknown as InternalObjectShape) as unknown as TypeDef<
    Prettify<ExtractTypesFromShape<T>>
  >;
}

function addDefToUnion(
  def: ComplexTypeDef,
  unionShape: UnionTypeDefs,
  unionTypenameField: string | undefined,
): string | undefined {
  const nestedMask = def.mask;

  if ((nestedMask & Mask.UNION) !== 0) {
    const nestedUnion = def as UnionDef;

    if (nestedUnion.typenameField !== undefined) {
      if (unionTypenameField !== undefined && unionTypenameField !== nestedUnion.typenameField) {
        throw new Error(
          `Union typename field conflict: Cannot merge unions with different typename fields ('${unionTypenameField}' vs '${nestedUnion.typenameField}')`,
        );
      }
      unionTypenameField = nestedUnion.typenameField;
    }

    const nestedShape = nestedUnion.shape;

    if (nestedShape !== undefined) {
      for (const key of [...Object.keys(nestedShape), ARRAY_KEY, RECORD_KEY] as const) {
        const value = nestedShape[key];

        if (unionShape[key] !== undefined && unionShape[key] !== value) {
          throw new Error(
            `Union merge conflict: Duplicate typename value '${String(key)}' found when merging nested unions (${String(unionShape[key])} vs ${String(value)})`,
          );
        }

        unionShape[key] = value as any;
      }
    }
  } else if ((nestedMask & Mask.ARRAY) !== 0) {
    if (unionShape[ARRAY_KEY] !== undefined) {
      throw new Error('Array shape already defined');
    }

    unionShape[ARRAY_KEY] = def.shape as InternalTypeDef;
  } else if ((nestedMask & Mask.RECORD) !== 0) {
    if (unionShape[RECORD_KEY] !== undefined) {
      throw new Error('Record shape already defined');
    }

    unionShape[RECORD_KEY] = def.shape as InternalTypeDef;
  } else {
    const typenameField = (def as ObjectDef).typenameField;
    const typename = (def as ObjectDef).typenameValue;

    if (typename === undefined) {
      throw new Error(
        'Object definitions must have a typename to be in a union with other objects, records, or arrays',
      );
    }

    if (unionTypenameField !== undefined && typenameField !== unionTypenameField) {
      throw new Error('Object definitions must have the same typename field to be in the same union');
    }

    unionTypenameField = typenameField;
    unionShape[typename] = def as ObjectDef;
  }

  return unionTypenameField;
}

function defineUnion<T extends readonly TypeDef[]>(...types: T): TypeDef<ExtractType<T[number]>> {
  type R = TypeDef<ExtractType<T[number]>>;
  const internalTypes = types as unknown as readonly InternalTypeDef[];

  let mask = 0;
  let defCount = 0;
  let firstDef: ComplexTypeDef | undefined;
  let values: Set<string | boolean | number> | undefined;
  let unionShape: UnionTypeDefs | undefined;
  let unionTypenameField: string | undefined;
  let defShapeKeys = 0;
  let defMask = 0;

  for (const type of internalTypes) {
    if (typeof type === 'number') {
      mask |= type;
      continue;
    }

    if (type instanceof Set) {
      if (values === undefined) {
        values = new Set(type);
      } else {
        for (const val of type) {
          values.add(val);
        }
      }

      continue;
    }

    defCount++;
    defMask |= type.mask;
    defShapeKeys += type.shapeKey;

    if (defCount === 1) {
      firstDef = type;
      continue;
    }

    if (defCount === 2) {
      unionShape = Object.create(null);
      unionTypenameField = addDefToUnion(firstDef!, unionShape!, unionTypenameField);
    }

    unionTypenameField = addDefToUnion(type, unionShape!, unionTypenameField);
  }

  if (defCount === 0) {
    if (values === undefined) {
      return mask as unknown as R;
    }

    if (mask === 0) {
      return values as unknown as R;
    }

    return new ValidatorDef(
      mask | Mask.UNION,
      undefined,
      hashValue([mask | Mask.UNION, values]) >>> 0,
      values,
    ) as unknown as R;
  }

  if (defCount === 1) {
    return ValidatorDef.cloneWith(firstDef as ValidatorDef<any>, mask) as unknown as R;
  }

  const finalMask = mask | defMask | Mask.UNION;
  return new ValidatorDef(
    finalMask,
    unionShape!,
    (hashValue([mask | Mask.UNION, values]) + defShapeKeys) >>> 0,
    values,
    unionTypenameField,
  ) as unknown as R;
}

function defineWithMask(type: TypeDef, mask: Mask, cache: WeakMap<ValidatorDef<any>, ValidatorDef<any>>): TypeDef {
  const t = type as unknown as InternalTypeDef;

  if (typeof t === 'number') {
    return (t | mask) as unknown as TypeDef;
  }

  if (t instanceof Set) {
    return defineUnion(type, mask as unknown as TypeDef);
  }

  let cached = cache.get(t as ValidatorDef<any>);
  if (cached === undefined) {
    cached = ValidatorDef.cloneWith(t as ValidatorDef<any>, mask);
    cache.set(t as ValidatorDef<any>, cached);
  }
  return cached as unknown as TypeDef;
}

const optionalCache = new WeakMap<ValidatorDef<any>, ValidatorDef<any>>();
const nullableCache = new WeakMap<ValidatorDef<any>, ValidatorDef<any>>();
const nullishCache = new WeakMap<ValidatorDef<any>, ValidatorDef<any>>();

function defineNullish<T extends TypeDef>(type: T): TypeDef<ExtractType<T> | undefined | null> {
  return defineWithMask(type, Mask.UNDEFINED | Mask.NULL, nullishCache) as TypeDef<ExtractType<T> | undefined | null>;
}

function defineOptional<T extends TypeDef>(type: T): TypeDef<ExtractType<T> | undefined> {
  return defineWithMask(type, Mask.UNDEFINED, optionalCache) as TypeDef<ExtractType<T> | undefined>;
}

function defineNullable<T extends TypeDef>(type: T): TypeDef<ExtractType<T> | null> {
  return defineWithMask(type, Mask.NULL, nullableCache) as TypeDef<ExtractType<T> | null>;
}

// -----------------------------------------------------------------------------
// Marker Functions
// -----------------------------------------------------------------------------

function defineTypename<T extends string>(value: T): TypeDef<T> {
  return value as unknown as TypeDef<T>;
}

function defineConst<T extends string | boolean | number>(value: T): TypeDef<T> {
  return new Set([value]) as unknown as TypeDef<T>;
}

const defineEnum = (<T extends readonly (string | boolean | number)[]>(...values: T): TypeDef<T[number]> => {
  return new Set(values as unknown as T[number][]) as unknown as TypeDef<T[number]>;
}) as unknown as APITypes['enum'];

(defineEnum as any).caseInsensitive = <T extends readonly (string | boolean | number)[]>(
  ...values: T
): TypeDef<T[number]> => {
  return new CaseInsensitiveSet(values as unknown as T[number][]) as unknown as TypeDef<T[number]>;
};

// -----------------------------------------------------------------------------
// Formatted Values
// -----------------------------------------------------------------------------

const FORMAT_MASK_SHIFT = 16;

let nextFormatId = 0;
const FORMAT_PARSERS: ((value: unknown) => unknown)[] = [];
const FORMAT_SERIALIZERS: ((value: unknown) => unknown)[] = [];
const FORMAT_MAP = new Map<string, number>();
const FORMAT_ID_TO_NAME = new Map<number, string>();

function defineFormatted<K extends keyof SignaliumQuery.FormatRegistry>(
  format: K,
): TypeDef<SignaliumQuery.FormatRegistry[K]> {
  const mask = FORMAT_MAP.get(format);

  if (mask === undefined) {
    throw new Error(`Format ${format} not registered`);
  }

  return mask as unknown as TypeDef<SignaliumQuery.FormatRegistry[K]>;
}

export function getFormat(mask: number): (value: unknown) => unknown {
  const formatId = mask >> FORMAT_MASK_SHIFT;

  return FORMAT_PARSERS[formatId];
}

export function getFormatSerializer(mask: number): ((value: unknown) => unknown) | undefined {
  const formatId = mask >> FORMAT_MASK_SHIFT;
  return FORMAT_SERIALIZERS[formatId];
}

export function getFormatName(mask: number): string | undefined {
  const formatId = mask >> FORMAT_MASK_SHIFT;
  return FORMAT_ID_TO_NAME.get(formatId);
}

export function registerFormat<Input extends Mask.STRING | Mask.NUMBER, T>(
  name: string,
  type: Input,
  parse: (value: Input extends Mask.STRING ? string : number) => T,
  serialize: (value: T) => Input extends Mask.STRING ? string : number,
) {
  const maskId = nextFormatId++;
  FORMAT_PARSERS[maskId] = parse as (value: unknown) => unknown;
  FORMAT_SERIALIZERS[maskId] = serialize as (value: unknown) => unknown;
  FORMAT_ID_TO_NAME.set(maskId, name);

  const shiftedId = maskId << FORMAT_MASK_SHIFT;
  const formatMask = type === Mask.STRING ? Mask.HAS_STRING_FORMAT : Mask.HAS_NUMBER_FORMAT;
  const mask = shiftedId | type | formatMask;

  FORMAT_MAP.set(name, mask);
}

// -----------------------------------------------------------------------------
// Built-in Formats
// -----------------------------------------------------------------------------

// Register 'date' format: ISO date string (YYYY-MM-DD) ↔ Date
registerFormat(
  'date',
  Mask.STRING,
  value => {
    // Parse YYYY-MM-DD as UTC date to avoid timezone issues
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid date string: ${value}. Expected YYYY-MM-DD format.`);
    }
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)));
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date string: ${value}`);
    }
    return date;
  },
  value => {
    // Format as YYYY-MM-DD using UTC to avoid timezone issues
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
);

// Register 'date-time' format: ISO datetime string (ISO 8601) ↔ Date
registerFormat(
  'date-time',
  Mask.STRING,
  value => {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date-time string: ${value}`);
    }
    return date;
  },
  value => {
    // Format as ISO 8601 string
    return value.toISOString();
  },
);

// -----------------------------------------------------------------------------
// Entity Definitions
// -----------------------------------------------------------------------------

import { Entity } from './proxy.js';

const entityDefCache = new WeakMap<new () => Entity, ValidatorDef<any>>();

/**
 * Gets or creates a ValidatorDef for an Entity class. Instantiates the class once,
 * extracts field values as the shape and prototype methods, then caches the result.
 */
export function getEntityDef(cls: new () => Entity): ValidatorDef<any> {
  let def = entityDefCache.get(cls);

  if (def === undefined) {
    const instance = new cls();

    const shape: InternalObjectShape = {};
    for (const [key, value] of entries(instance as Record<string, unknown>)) {
      shape[key] = value as any;
    }

    // Throw when subclass redefines a field that exists on a parent Entity.
    // Only throw when the subclass provides a different value for a parent key (shadowing), not for inherited keys.
    const parentProto = Object.getPrototypeOf(cls.prototype);
    if (parentProto != null) {
      const ParentClass = parentProto.constructor as new () => Entity;
      if (ParentClass !== Entity && typeof ParentClass === 'function') {
        const parentDef = getEntityDef(ParentClass);
        const parentShape = parentDef.shape as InternalObjectShape;
        for (const key of Object.keys(parentShape)) {
          if (key in shape && shape[key] !== parentShape[key]) {
            throw new Error(`Cannot extend: field '${key}' already exists in type definition`);
          }
        }
      }
    }

    const methods: EntityMethods = {};
    const proto = cls.prototype;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof proto[key] === 'function') {
        methods[key] = proto[key];
      }
    }

    def = defineObjectOrEntity(Mask.ENTITY | Mask.OBJECT, shape);

    def._entityClass = cls;

    if (Object.keys(methods).length > 0) {
      def._methods = methods;
    }

    const staticCls = cls as typeof Entity;
    if (staticCls.stream) {
      def._entityConfig = { stream: staticCls.stream } as any;
    }

    if (staticCls.cache) {
      def._entityCache = staticCls.cache;
    }

    entityDefCache.set(cls, def);
  }

  return def;
}

function defineEntityType(cls: new () => Entity): TypeDef<any> {
  return getEntityDef(cls) as unknown as TypeDef<any>;
}

export const t: APITypes = {
  format: defineFormatted,
  typename: defineTypename,
  const: defineConst,
  enum: defineEnum,
  id: (Mask.ID | Mask.STRING | Mask.NUMBER) as unknown as TypeDef<string | number>,
  string: Mask.STRING as unknown as TypeDef<string>,
  number: Mask.NUMBER as unknown as TypeDef<number>,
  boolean: Mask.BOOLEAN as unknown as TypeDef<boolean>,
  null: Mask.NULL as unknown as TypeDef<null>,
  undefined: Mask.UNDEFINED as unknown as TypeDef<undefined>,
  array: defineArray,
  object: defineObject,
  record: defineRecord,
  union: defineUnion,
  nullish: defineNullish,
  optional: defineOptional,
  nullable: defineNullable,
  result: defineParseResult,
  entity: defineEntityType,
};

/**
 * Extract the internal shape key from a TypeDef. Used in tests and
 * internal tooling to access the ValidatorDef's shape key.
 */
export function getShapeKey(def: TypeDef): number {
  return (def as unknown as ValidatorDef<any>).shapeKey;
}
