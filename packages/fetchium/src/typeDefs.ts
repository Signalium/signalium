import {
  APITypes,
  ARRAY_KEY,
  ComplexTypeDef,
  EntityConfig,
  EntityMethods,
  ExtractType,
  InternalTypeDef,
  InternalObjectShape,
  LiveArrayOptions,
  LiveFieldConfig,
  LiveValueOptions,
  Mask,
  ObjectDef,
  RECORD_KEY,
  TypeDef,
  UnionDef,
  UnionTypeDefs,
} from './types.js';
import { Prettify } from './type-utils.js';
import { hashValue, registerCustomHash } from 'signalium/utils';

const entries = Object.entries;
const isArray = Array.isArray;
const keys = Object.keys;

let assertFieldTypesCompatible: (typename: string, field: string, a: unknown, b: unknown) => void = () => {};

if (IS_DEV) {
  const SHIFT = 16;

  const setsEqual = (a: Set<unknown>, b: Set<unknown>): boolean => {
    if (a.size !== b.size) return false;
    for (const v of a) {
      if (!b.has(v)) return false;
    }
    return true;
  };

  const fieldTypesCompatible = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'number') {
      const bNum = b as number;
      if ((a & 0xffff) !== (bNum & 0xffff)) return false;
      const aFormat = a >> SHIFT;
      const bFormat = bNum >> SHIFT;
      if (aFormat !== 0 && bFormat !== 0 && aFormat !== bFormat) return false;
      return true;
    }

    if (typeof a === 'string') return a === b;

    if (a instanceof Set && b instanceof Set) {
      return setsEqual(a, b);
    }

    if (a instanceof ValidatorDef && b instanceof ValidatorDef) {
      const aMask = a.mask as number;
      const bMask = b.mask as number;
      if ((aMask & 0xffff) !== (bMask & 0xffff)) return false;
      const aFormat = aMask >> SHIFT;
      const bFormat = bMask >> SHIFT;
      if (aFormat !== 0 && bFormat !== 0 && aFormat !== bFormat) return false;

      if (a.shape === b.shape) return true;

      if (
        a.shape !== undefined &&
        b.shape !== undefined &&
        typeof a.shape === 'object' &&
        typeof b.shape === 'object'
      ) {
        const aShape = a.shape as Record<string, unknown>;
        const bShape = b.shape as Record<string, unknown>;
        for (const key of Object.keys(aShape)) {
          if (key in bShape && !fieldTypesCompatible(aShape[key], bShape[key])) return false;
        }
        for (const key of Object.keys(bShape)) {
          if (key in aShape && !fieldTypesCompatible(aShape[key], bShape[key])) return false;
        }
      }

      return true;
    }

    return false;
  };

  assertFieldTypesCompatible = (typename: string, field: string, a: unknown, b: unknown) => {
    if (!fieldTypesCompatible(a, b)) {
      throw new Error(
        `[fetchium] Entity typename '${typename}' has incompatible type for field '${field}' across different entity definitions`,
      );
    }
  };
}

function makeOptional(fieldDef: unknown): unknown {
  if (typeof fieldDef === 'number') {
    return fieldDef | Mask.UNDEFINED;
  }
  if (fieldDef instanceof ValidatorDef) {
    if ((fieldDef.mask & Mask.UNDEFINED) !== 0) return fieldDef;
    return ValidatorDef.cloneWith(fieldDef, Mask.UNDEFINED);
  }
  return fieldDef;
}

function isPlainObjectDef(fieldDef: unknown): fieldDef is ValidatorDef<any> {
  return (
    fieldDef instanceof ValidatorDef &&
    (fieldDef.mask & Mask.OBJECT) !== 0 &&
    (fieldDef.mask & (Mask.ENTITY | Mask.ARRAY | Mask.UNION | Mask.RECORD | Mask.LIVE)) === 0
  );
}

function mergeObjectShapes(
  shapes: (Record<string, unknown> | undefined)[],
  count: number,
  typename: string,
): Record<string, unknown> {
  const allKeys = new Set<string>();
  for (const shape of shapes) {
    if (shape !== undefined) {
      for (const key of Object.keys(shape)) {
        allKeys.add(key);
      }
    }
  }

  const merged: Record<string, unknown> = {};

  for (const key of allKeys) {
    let presentCount = 0;
    let firstDef: unknown = undefined;
    const nestedShapes: (Record<string, unknown> | undefined)[] = [];
    let allPlainObjects = true;

    for (const shape of shapes) {
      const fieldDef = shape?.[key];
      if (fieldDef !== undefined) {
        presentCount++;
        if (firstDef === undefined) firstDef = fieldDef;
        if (IS_DEV && firstDef !== undefined && fieldDef !== firstDef && !isPlainObjectDef(fieldDef)) {
          assertFieldTypesCompatible(typename, key, firstDef, fieldDef);
        }
        if (isPlainObjectDef(fieldDef)) {
          nestedShapes.push(fieldDef.shape as Record<string, unknown>);
        } else {
          allPlainObjects = false;
          nestedShapes.push(undefined);
        }
      } else {
        allPlainObjects = false;
        nestedShapes.push(undefined);
      }
    }

    if (allPlainObjects && presentCount > 0) {
      const innerMerged = mergeObjectShapes(nestedShapes, count, typename);
      const newDef = new ValidatorDef(Mask.OBJECT, innerMerged as any);
      merged[key] = presentCount < count ? makeOptional(newDef) : newDef;
    } else {
      merged[key] = presentCount < count ? makeOptional(firstDef!) : firstDef!;
    }
  }

  return merged;
}

export class ValidatorDef<T> {
  public mask: Mask;
  public shape: InternalTypeDef | InternalObjectShape | UnionTypeDefs | ComplexTypeDef[] | undefined;
  public typenameField: string | undefined = undefined;
  public typenameValue: string | undefined = undefined;
  public idField: string | symbol | undefined = undefined;
  public values: Set<string | boolean | number> | undefined = undefined;

  /**
   * Methods object for entity definitions.
   * Shared across all proxies, but each proxy binds its own reactive method wrappers.
   */
  public _methods: EntityMethods | undefined = undefined;

  /**
   * Entity configuration including stream options.
   */
  public _entityConfig: EntityConfig | undefined = undefined;

  /**
   * The original Entity class for this definition.
   * Used by createEntityProxy to set the proxy prototype so `instanceof` works.
   */
  public _entityClass: (new () => any) | undefined = undefined;

  /**
   * Entity cache options (e.g. gcTime for in-memory eviction).
   */
  public _entityCache: { gcTime?: number } | undefined = undefined;

  /**
   * Live collection configuration (shared by LiveArray and LiveValue).
   */
  public _liveConfig: LiveFieldConfig | undefined = undefined;

  constructor(
    mask: Mask,
    shape: InternalTypeDef | InternalObjectShape | UnionTypeDefs | ComplexTypeDef[] | undefined,
    values?: Set<string | boolean | number>,
    typenameField?: string,
    typenameValue?: string,
    idField?: string | symbol,
  ) {
    this.mask = mask;
    this.shape = shape;
    this.values = values;
    this.typenameField = typenameField;
    this.typenameValue = typenameValue;
    this.idField = idField;
  }

  static merge(defs: ValidatorDef<any>[]): ValidatorDef<any> {
    if (defs.length === 1) return defs[0];

    const count = defs.length;
    const shapes = defs.map(d => d.shape as Record<string, unknown> | undefined);
    const typename = defs[0].typenameValue ?? '(unknown)';

    const mergedShape = mergeObjectShapes(shapes, count, typename);

    let idField: string | symbol | undefined;
    let typenameField: string | undefined;
    let typenameValue: string | undefined;

    for (const def of defs) {
      if (idField === undefined && def.idField !== undefined) {
        idField = def.idField;
      } else if (idField !== undefined && def.idField !== undefined && def.idField !== idField) {
        throw new Error(
          `[fetchium] Entity typename '${def.typenameValue}' has conflicting id fields: '${String(idField)}' vs '${String(def.idField)}'`,
        );
      }

      if (typenameField === undefined) typenameField = def.typenameField;
      if (typenameValue === undefined) typenameValue = def.typenameValue;
    }

    return new ValidatorDef(
      Mask.ENTITY | Mask.OBJECT,
      mergedShape as any,
      undefined,
      typenameField,
      typenameValue,
      idField,
    );
  }

  static cloneWith(def: ValidatorDef<any>, mask: Mask): ValidatorDef<any> {
    const newDef = new ValidatorDef(
      mask | def.mask,
      def.shape,
      def.values,
      def.typenameField,
      def.typenameValue,
      def.idField,
    );
    newDef._methods = def._methods;
    newDef._entityConfig = def._entityConfig;
    newDef._entityClass = def._entityClass;
    newDef._entityCache = def._entityCache;
    newDef._liveConfig = def._liveConfig;
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

const CASE_INSENSITIVE_SET_SEED = 0x43494553;

registerCustomHash(CaseInsensitiveSet, set => {
  let sum = CASE_INSENSITIVE_SET_SEED;
  for (const value of set) {
    sum += hashValue(value);
  }
  return sum >>> 0;
});

// -----------------------------------------------------------------------------
// Complex Type Definitions
// -----------------------------------------------------------------------------

function defineWrapperType(mask: Mask, shape: InternalTypeDef): ValidatorDef<any> {
  return new ValidatorDef(mask, shape);
}

export function defineArray<T extends TypeDef>(shape: T): TypeDef<ExtractType<T>[]> {
  return defineWrapperType(Mask.ARRAY, shape as unknown as InternalTypeDef) as unknown as TypeDef<ExtractType<T>[]>;
}

export function defineRecord<T extends TypeDef>(shape: T): TypeDef<Record<string, ExtractType<T>>> {
  return defineWrapperType(Mask.RECORD | Mask.OBJECT, shape as unknown as InternalTypeDef) as unknown as TypeDef<
    Record<string, ExtractType<T>>
  >;
}

export function defineParseResult<T extends TypeDef>(
  innerType: T,
): TypeDef<import('./types.js').ParseResult<ExtractType<T>>> {
  return defineWrapperType(Mask.PARSE_RESULT, innerType as unknown as InternalTypeDef) as unknown as TypeDef<
    import('./types.js').ParseResult<ExtractType<T>>
  >;
}

function defineObjectOrEntity(baseMask: Mask, shape: InternalObjectShape): ValidatorDef<any> {
  let mask = baseMask;
  let idField: string | undefined = undefined;
  let typenameField: string | undefined = undefined;
  let typenameValue: string | undefined = undefined;

  for (const [key, value] of entries(shape)) {
    switch (typeof value) {
      case 'number':
        if ((value & Mask.ID) !== 0) {
          if (idField !== undefined) {
            throw new Error(`Duplicate id field: ${key}`);
          }

          idField = key;
        }
        break;
      case 'string':
        if (typenameField !== undefined && typenameField !== key) {
          throw new Error(`Duplicate typename field: ${key}`);
        }

        typenameField = key;
        typenameValue = value;
        break;
      case 'object':
        if (value instanceof CaseInsensitiveSet || value instanceof Set) {
          break;
        }

        if (value.mask & Mask.LIVE) {
          mask |= Mask.LIVE;
        }
        break;
    }
  }

  return new ValidatorDef(mask, shape, undefined, typenameField, typenameValue, idField);
}

export function defineObject<T extends Record<string, TypeDef>>(shape: T): TypeDef<ExtractType<T>> {
  return defineObjectOrEntity(Mask.OBJECT, shape as unknown as InternalObjectShape) as unknown as TypeDef<
    ExtractType<T>
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
      for (const key of [...keys(nestedShape), ARRAY_KEY, RECORD_KEY] as const) {
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

    return new ValidatorDef(mask | Mask.UNION, undefined, values) as unknown as R;
  }

  if (defCount === 1) {
    return ValidatorDef.cloneWith(firstDef as ValidatorDef<any>, mask) as unknown as R;
  }

  const finalMask = mask | defMask | Mask.UNION;
  return new ValidatorDef(finalMask, unionShape!, values, unionTypenameField) as unknown as R;
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

export const FORMAT_MASK_SHIFT = 16;

let nextFormatId = 0;
const FORMAT_PARSERS: ((value: unknown) => unknown)[] = [];
const FORMAT_SERIALIZERS: ((value: unknown) => unknown)[] = [];
const FORMAT_MAP = new Map<string, number>();
const FORMAT_ID_TO_NAME: Map<number, string> | undefined = IS_DEV ? new Map<number, string>() : undefined;

export const WRAPPED_VALUE = new WeakSet();

export class FormattedValue {
  _raw: unknown;
  private _formatted: unknown;
  private _parsed: boolean;
  private _formatId: number;

  constructor(raw: unknown, formatId: number, eager: boolean) {
    this._raw = raw;
    this._formatId = formatId;
    if (eager) {
      this._formatted = FORMAT_PARSERS[formatId](raw);
      this._parsed = true;
    } else {
      this._parsed = false;
    }
    WRAPPED_VALUE.add(this);
  }

  getValue(): unknown {
    if (!this._parsed) {
      this._formatted = FORMAT_PARSERS[this._formatId](this._raw);
      this._parsed = true;
    }
    return this._formatted;
  }

  toJSON(): unknown {
    if (this._parsed) {
      return FORMAT_SERIALIZERS[this._formatId](this._formatted);
    }
    return this._raw;
  }
}

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

export function getSerializer(mask: number): (value: unknown) => unknown {
  const formatId = mask >> FORMAT_MASK_SHIFT;
  return FORMAT_SERIALIZERS[formatId];
}

export function getFormatName(mask: number): string | undefined {
  if (!IS_DEV) return undefined;
  const formatId = mask >> FORMAT_MASK_SHIFT;
  return FORMAT_ID_TO_NAME!.get(formatId);
}

export function registerFormat<Input extends Mask.STRING | Mask.NUMBER, T>(
  name: string,
  type: Input,
  parse: (value: Input extends Mask.STRING ? string : number) => T,
  serialize: (value: T) => Input extends Mask.STRING ? string : number,
  options?: { eager?: boolean },
) {
  const maskId = nextFormatId++;
  FORMAT_PARSERS[maskId] = parse as (value: unknown) => unknown;
  FORMAT_SERIALIZERS[maskId] = serialize as (value: unknown) => unknown;
  if (IS_DEV) FORMAT_ID_TO_NAME!.set(maskId, name);

  const eager = options?.eager ?? true;
  const shiftedId = maskId << FORMAT_MASK_SHIFT;
  const mask = shiftedId | type | Mask.HAS_FORMAT | (eager ? Mask.IS_EAGER_FORMAT : 0);

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

    const raw = (instance as any)[DEFINITION_TARGET] ?? instance;
    if ((instance as any)[CANCEL_PROXY]) {
      (instance as any)[CANCEL_PROXY]();
    }

    const shape: InternalObjectShape = {};
    for (const [key, value] of entries(raw as Record<string, unknown>)) {
      if (IS_DEV) {
        const isValidDef =
          typeof value === 'number' ||
          typeof value === 'string' ||
          value instanceof Set ||
          value instanceof ValidatorDef ||
          value instanceof CaseInsensitiveSet;

        if (!isValidDef) {
          throw new Error(
            `[fetchium] Entity '${cls.name}' field '${key}' has an invalid type definition. ` +
              `All entity fields must be type definitions (e.g. t.string, t.number, t.entity(...), etc). ` +
              `Got: ${typeof value === 'object' ? (value?.constructor?.name ?? typeof value) : typeof value}`,
          );
        }
      }
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
        for (const key of keys(parentShape)) {
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

    if (keys(methods).length > 0) {
      def._methods = methods;
    }

    if (typeof methods['__subscribe'] === 'function') {
      def._entityConfig = { hasSubscribe: true };
    }

    const staticCls = cls as typeof Entity;

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

// -----------------------------------------------------------------------------
// LiveArray / LiveValue Definitions
// -----------------------------------------------------------------------------

import { isFieldRef, DEFINITION_TARGET, CANCEL_PROXY } from './fieldRef.js';

function buildConstraintFieldRefs(
  entityDefs: ValidatorDef<any>[],
  constraints: unknown,
): Map<string, Array<[string, unknown]>> | undefined {
  if (constraints === undefined || constraints === null) return undefined;

  const result = new Map<string, Array<[string, unknown]>>();

  if (Array.isArray(constraints)) {
    for (const entry of constraints) {
      const [cls, constraintMap] = entry as [new () => Entity, Record<string, unknown>];
      const def = getEntityDef(cls);
      const typename = def.typenameValue;
      if (typename === undefined) continue;
      const pairs: Array<[string, unknown]> = [];
      for (const [field, ref] of Object.entries(constraintMap)) {
        pairs.push([field, ref]);
      }
      if (pairs.length > 0) {
        result.set(typename, pairs);
      }
    }
  } else {
    const constraintMap = constraints as Record<string, unknown>;
    const constraintEntries = Object.entries(constraintMap);
    if (constraintEntries.length === 0) return undefined;

    const pairs: Array<[string, unknown]> = constraintEntries.map(([field, ref]) => [field, ref]);

    for (const def of entityDefs) {
      const typename = def.typenameValue;
      if (typename !== undefined) {
        result.set(typename, pairs);
      }
    }
  }

  return result.size > 0 ? result : undefined;
}

function resolveEntityDefs(entityOrArray: unknown): ValidatorDef<any>[] {
  if (Array.isArray(entityOrArray)) {
    return entityOrArray.map(cls => getEntityDef(cls as new () => Entity));
  }
  return [getEntityDef(entityOrArray as new () => Entity)];
}

function defineLiveArray(entityOrArray: unknown, opts?: LiveArrayOptions<any>): TypeDef<any> {
  const entityDefs = resolveEntityDefs(entityOrArray);

  const innerDef =
    entityDefs.length === 1
      ? entityDefs[0]
      : (defineUnion(...entityDefs.map(d => d as unknown as TypeDef)) as unknown as ValidatorDef<any>);

  const mask = Mask.ARRAY | Mask.LIVE;
  const def = new ValidatorDef(mask, innerDef as unknown as InternalTypeDef);

  def._liveConfig = LiveFieldConfig.array(
    entityDefs,
    buildConstraintFieldRefs(entityDefs, opts?.constraints),
    opts?.sort as ((a: unknown, b: unknown) => number) | undefined,
  );

  return def as unknown as TypeDef<any>;
}

function defineLiveValue(valueType: TypeDef, entityOrArray: unknown, opts: LiveValueOptions<any, any>): TypeDef<any> {
  const entityDefs = resolveEntityDefs(entityOrArray);

  const valueInternalType = valueType as unknown as InternalTypeDef;

  const mask = Mask.LIVE;
  const def = new ValidatorDef(mask, undefined);

  def._liveConfig = LiveFieldConfig.value(
    entityDefs,
    buildConstraintFieldRefs(entityDefs, opts?.constraints),
    valueInternalType,
    opts.onCreate,
    opts.onUpdate,
    opts.onDelete,
  );

  return def as unknown as TypeDef<any>;
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
  liveArray: defineLiveArray as APITypes['liveArray'],
  liveValue: defineLiveValue as APITypes['liveValue'],
};
