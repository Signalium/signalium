import {
  APITypes,
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityConfig,
  EntityDef,
  EntityMethods,
  ExtractTypesFromShape,
  Formatted,
  Mask,
  ObjectDef,
  ObjectShape,
  RECORD_KEY,
  RecordDef,
  TypeDef,
  UnionDef,
  UnionTypeDefs,
} from './types.js';
import { Prettify } from './type-utils.js';
import { hashValue } from 'signalium/utils';

const entries = Object.entries;
const isArray = Array.isArray;

const enum ComplexTypeDefKind {
  OBJECT = 0,
  UNION = 1,
  PRIMITIVE_UNION = 2,
  ARRAY = 3,
  RECORD = 4,
  ENTITY = 5,
}

export class ValidatorDef<T> {
  private kind: ComplexTypeDefKind;
  public mask: Mask;
  private _optional: ValidatorDef<T | undefined> | undefined;
  private _nullable: ValidatorDef<T | null> | undefined;
  private _nullish: ValidatorDef<T | null | undefined> | undefined;
  private _shapeKey: number | undefined = undefined;
  private _shape: TypeDef | ObjectShape | UnionTypeDefs | (() => ObjectShape) | ComplexTypeDef[] | undefined;
  public subEntityPaths: undefined | string | string[] = undefined;
  public typenameField: string | undefined = undefined;
  public typenameValue: string | undefined = undefined;
  public idField: string | undefined = undefined;
  public values: Set<string | boolean | number> | undefined = undefined;
  /**
   * Lazy factory function for creating entity methods.
   * Evaluated once during reifyShape() and cached in _methods.
   */
  public _methodsFactory: (() => EntityMethods) | undefined = undefined;

  /**
   * Cached methods object from evaluating _methodsFactory.
   * Populated during reifyShape() - the same methods object is shared across all proxies,
   * but each proxy binds its own reactive method wrappers.
   */
  public _methods: EntityMethods | undefined = undefined;

  /**
   * Entity configuration including stream options.
   */
  public _entityConfig: EntityConfig<any> | undefined = undefined;

  constructor(
    kind: ComplexTypeDefKind,
    mask: Mask,
    shape: TypeDef | ObjectShape | UnionTypeDefs | (() => ObjectShape) | ComplexTypeDef[] | undefined,
    values: Set<string | boolean | number> | undefined = undefined,
  ) {
    this.kind = kind;
    this.mask = mask;
    this._shape = shape;
    this.values = values;
  }

  static cloneWith(
    def: ValidatorDef<any>,
    mask: Mask,
    values: Set<string | boolean | number> | undefined = undefined,
  ): ValidatorDef<any> {
    const newDef = new ValidatorDef(def.kind, mask | def.mask, def._shape, values);
    newDef.subEntityPaths = def.subEntityPaths;
    newDef.values = def.values;
    newDef.typenameField = def.typenameField;
    newDef.typenameValue = def.typenameValue;
    newDef.idField = def.idField;
    newDef._methodsFactory = def._methodsFactory;
    newDef._methods = def._methods;
    newDef._entityConfig = def._entityConfig;
    return newDef;
  }

  reifyShape() {
    if (this._shapeKey === undefined) {
      switch (this.kind) {
        case ComplexTypeDefKind.ENTITY: {
          const shape = (this._shape as () => ObjectShape)();
          this._shape = reifyObjectShape(this, shape);
          // Evaluate and cache the methods factory once during shape reification
          if (this._methodsFactory && !this._methods) {
            this._methods = this._methodsFactory();
          }
          break;
        }
        case ComplexTypeDefKind.OBJECT:
          this._shape = reifyObjectShape(this, this._shape as ObjectShape);
          break;
        case ComplexTypeDefKind.UNION:
          this._shape = reifyUnionShape(this, this._shape as ComplexTypeDef[]);
          break;
        case ComplexTypeDefKind.ARRAY:
        case ComplexTypeDefKind.RECORD: {
          const shape = this._shape as ComplexTypeDef;
          this._shapeKey = hashValue([this.mask, this.values, shape.shapeKey]);
          if (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) {
            this.mask |= Mask.HAS_SUB_ENTITY;
          }
          break;
        }
      }
    }
  }

  get shape(): TypeDef | ObjectShape | UnionTypeDefs | undefined {
    this.reifyShape();

    return this._shape as TypeDef | ObjectShape | UnionTypeDefs | undefined;
  }

  get methods(): EntityMethods | undefined {
    this.reifyShape();

    return this._methods;
  }

  get shapeKey(): number {
    this.reifyShape();

    return this._shapeKey!;
  }

  set shapeKey(key: number) {
    this._shapeKey = key >>> 0;
  }

  get optional(): ValidatorDef<T | undefined> {
    if (this._optional === undefined) {
      this._optional = ValidatorDef.cloneWith(this, Mask.UNDEFINED);
    }
    return this._optional;
  }

  get nullable(): ValidatorDef<T | null> {
    if (this._nullable === undefined) {
      this._nullable = ValidatorDef.cloneWith(this, Mask.NULL);
    }
    return this._nullable;
  }

  get nullish(): ValidatorDef<T | null | undefined> {
    if (this._nullish === undefined) {
      this._nullish = ValidatorDef.cloneWith(this, Mask.UNDEFINED | Mask.NULL);
    }
    return this._nullish;
  }

  /**
   * Creates a new ValidatorDef that extends this one with additional fields and optional methods.
   * Only valid for ENTITY and OBJECT types.
   * Prevents overriding of existing fields including id and typename.
   *
   * For entities, accepts a function that returns the new fields (lazy reification).
   * For objects, accepts the new fields directly.
   *
   * @param newFieldsOrGetter - New fields to add (lazy function for entities, direct object for objects)
   * @param newMethodsGetter - Optional lazy factory returning new methods to add (entities only, merged with existing)
   */
  extend<U extends ObjectShape, N extends EntityMethods = EntityMethods>(
    newFieldsOrGetter: U | (() => U),
    // Note: ThisType here will be the extended entity type - TypeScript infers it from context
    newMethodsGetter?: () => N,
  ): ValidatorDef<any> {
    // Validate that this is an extendable type (ENTITY or OBJECT)
    if (this.kind !== ComplexTypeDefKind.ENTITY && this.kind !== ComplexTypeDefKind.OBJECT) {
      throw new Error('extend() can only be called on Entity or Object types');
    }

    if (this.kind === ComplexTypeDefKind.ENTITY) {
      // For entities, keep the shape lazy - only reify on first usage
      // This preserves the lazy evaluation pattern and supports circular references
      // We bind getParentShape to access the parent's `.shape` getter which properly
      // reifies and caches the shape, avoiding multiple reification calls
      const newFieldsGetter = newFieldsOrGetter as () => U;
      const parentMethodsFactory = this._methodsFactory;

      const extendedDef = new ValidatorDef(ComplexTypeDefKind.ENTITY, this.mask, () => {
        const existingShape = this.shape as ObjectShape;
        const newFields = newFieldsGetter();

        // Runtime validation: check for field conflicts
        for (const key of Object.keys(newFields)) {
          if (key in existingShape) {
            throw new Error(`Cannot extend: field '${key}' already exists in type definition`);
          }
        }

        return { ...existingShape, ...newFields };
      });

      // Merge methods factories if either parent or new methods exist
      if (parentMethodsFactory || newMethodsGetter) {
        extendedDef._methodsFactory = () => {
          const parentMethods = parentMethodsFactory ? parentMethodsFactory() : {};
          const newMethods = newMethodsGetter ? newMethodsGetter() : {};
          return { ...parentMethods, ...newMethods } as EntityMethods;
        };
      }

      // Preserve entity config from parent
      extendedDef._entityConfig = this._entityConfig;

      return extendedDef;
    } else {
      // For objects, reify immediately since they're not lazy
      this.reifyShape();

      const existingShape = this._shape as ObjectShape;
      const newFields = newFieldsOrGetter as U;

      // Runtime validation: check for field conflicts
      for (const key of Object.keys(newFields)) {
        if (key in existingShape) {
          throw new Error(`Cannot extend: field '${key}' already exists in type definition`);
        }
      }

      return new ValidatorDef(ComplexTypeDefKind.OBJECT, this.mask, { ...existingShape, ...newFields });
    }
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

export function defineArray<T extends TypeDef>(shape: T): ArrayDef<T> {
  return new ValidatorDef(ComplexTypeDefKind.ARRAY, Mask.ARRAY, shape) as unknown as ArrayDef<T>;
}

export function defineRecord<T extends TypeDef>(shape: T): RecordDef<T> {
  return new ValidatorDef(ComplexTypeDefKind.RECORD, Mask.RECORD | Mask.OBJECT, shape) as unknown as RecordDef<T>;
}

export function defineObject<T extends ObjectShape>(shape: T): ObjectDef<T> {
  return new ValidatorDef(ComplexTypeDefKind.OBJECT, Mask.OBJECT, shape) as unknown as ObjectDef<T>;
}

function defineUnion<T extends readonly TypeDef[]>(...types: T): UnionDef<T> {
  let mask = 0;
  let definition: ComplexTypeDef | undefined;
  let shape: ComplexTypeDef[] | undefined;
  let values: Set<string | boolean | number> | undefined;

  for (const type of types) {
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

    if (definition === undefined) {
      definition = type;
      continue;
    }

    if (shape === undefined) {
      shape = [definition];
    }

    shape.push(type);
  }

  if (definition === undefined) {
    // It was a union of primitives, so return the mask
    if (values === undefined) {
      // This type coercion is incorrect, but we can't return the mask as a Mask
      // because that loses the type information about the union, which breaks
      // inference.
      //
      // TODO: Figure out how to make this correct type-wise
      return mask as unknown as UnionDef<T>;
    }

    // It was a union of enums/constants, so return the value as a Set
    if (mask === 0) {
      // This type coercion is incorrect, but we can't return the mask as a Mask
      // because that loses the type information about the union, which breaks
      // inference.
      //
      // TODO: Figure out how to make this correct type-wise

      return values as unknown as UnionDef<T>;
    }

    // It was a union of primitives and enums, so return the mask and values as a new ValidatorDef
    return new ValidatorDef(ComplexTypeDefKind.PRIMITIVE_UNION, mask | Mask.UNION, undefined, values) as UnionDef;
  }

  // It was a single complex type, so return the clone with the new mask and values
  if (shape === undefined) {
    return ValidatorDef.cloneWith(definition as ValidatorDef<any>, mask | Mask.UNION, values) as UnionDef<T>;
  }

  return new ValidatorDef(ComplexTypeDefKind.UNION, mask | Mask.UNION, shape, values) as UnionDef;
}

function defineNullish<T extends TypeDef>(type: T): T | Mask.UNDEFINED | Mask.NULL {
  if (typeof type === 'number') {
    return (type | Mask.UNDEFINED | Mask.NULL) as T | Mask.UNDEFINED | Mask.NULL;
  }

  if (type instanceof Set) {
    return defineUnion(type, Mask.UNDEFINED, Mask.NULL) as T | Mask.UNDEFINED | Mask.NULL;
  }

  // Complex type - use the cached property
  return type.nullish as T | Mask.UNDEFINED | Mask.NULL;
}

function defineOptional<T extends TypeDef>(type: T): T | Mask.UNDEFINED {
  if (typeof type === 'number') {
    return (type | Mask.UNDEFINED) as T | Mask.UNDEFINED;
  }

  if (type instanceof Set) {
    return defineUnion(type, Mask.UNDEFINED) as T | Mask.UNDEFINED;
  }

  // Complex type - use the cached property
  return type.optional as T | Mask.UNDEFINED;
}

function defineNullable<T extends TypeDef>(type: T): T | Mask.NULL {
  if (typeof type === 'number') {
    return (type | Mask.NULL) as T | Mask.NULL;
  }

  if (type instanceof Set) {
    return defineUnion(type, Mask.NULL) as T | Mask.NULL;
  }

  // Complex type - use the cached property
  return type.nullable as T | Mask.NULL;
}

// -----------------------------------------------------------------------------
// Shape Reification
// -----------------------------------------------------------------------------

export function reifyObjectShape(def: ValidatorDef<any>, shape: ObjectShape): ObjectShape {
  // create a hash of the shape, starting with the object mask as the base
  let shapeKey = hashValue([def.mask, def.values]);

  for (const [key, value] of entries(shape)) {
    switch (typeof value) {
      case 'number':
        if ((value & Mask.ID) !== 0) {
          if (def.idField !== undefined) {
            throw new Error(`Duplicate id field: ${key}`);
          }

          def.idField = key;
        }

        // Add to shape key (order independent operation)
        shapeKey += hashValue(key) ^ value;
        break;
      case 'string':
        // This is a typename field (plain string value)
        if (def.typenameField !== undefined && def.typenameField !== key) {
          throw new Error(`Duplicate typename field: ${key}`);
        }

        def.typenameField = key;
        def.typenameValue = value;

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
          def.mask |= Mask.HAS_SUB_ENTITY;
          if (def.subEntityPaths === undefined) {
            def.subEntityPaths = key;
          } else if (isArray(def.subEntityPaths)) {
            def.subEntityPaths.push(key);
          } else {
            def.subEntityPaths = [def.subEntityPaths, key];
          }
        }
        break;
    }
  }

  // Convert to unsigned 32-bit integer
  def.shapeKey = shapeKey >>> 0;

  return shape;
}

function reifyUnionShape(def: ValidatorDef<any>, defs: ComplexTypeDef[]): UnionTypeDefs {
  let mask = def.mask;

  let shape: UnionTypeDefs = Object.create(null);
  let unionTypenameField: string | undefined;

  // Start with the union mask and any values as the base
  let shapeKey = hashValue([mask, def.values]);

  for (const nestedDef of defs) {
    const nestedMask = nestedDef.mask;

    mask |= nestedMask;

    // load the shape key and also reify the shape if not yet reified
    shapeKey += nestedDef.shapeKey;

    if ((nestedMask & Mask.UNION) !== 0) {
      // Merge nested union into parent union
      const nestedUnion = nestedDef as UnionDef;

      // Check typename field consistency
      if (nestedUnion.typenameField !== undefined) {
        if (unionTypenameField !== undefined && unionTypenameField !== nestedUnion.typenameField) {
          throw new Error(
            `Union typename field conflict: Cannot merge unions with different typename fields ('${unionTypenameField}' vs '${nestedUnion.typenameField}')`,
          );
        }
        unionTypenameField = nestedUnion.typenameField;
      }

      const nestedShape = nestedUnion.shape;

      // Merge nested union's shape into parent
      if (nestedShape !== undefined) {
        for (const key of [...Object.keys(nestedShape), ARRAY_KEY, RECORD_KEY] as const) {
          // Check for conflicts
          const value = nestedShape[key];

          if (shape[key] !== undefined && shape[key] !== value) {
            throw new Error(
              `Union merge conflict: Duplicate typename value '${String(key)}' found when merging nested unions (${String(shape[key])} vs ${String(value)})`,
            );
          }

          // coerce type because we know the value is the same type as the key
          shape[key] = value as any;
        }
      }
    } else if ((nestedMask & Mask.ARRAY) !== 0) {
      if (shape[ARRAY_KEY] !== undefined) {
        throw new Error('Array shape already defined');
      }

      shape[ARRAY_KEY] = nestedDef.shape as TypeDef;
    } else if ((nestedMask & Mask.RECORD) !== 0) {
      if (shape[RECORD_KEY] !== undefined) {
        throw new Error('Record shape already defined');
      }

      shape[RECORD_KEY] = nestedDef.shape as TypeDef;
    } else {
      // definition is ObjectDef | EntityDef
      const typenameField = (nestedDef as ObjectDef).typenameField;
      const typename = (nestedDef as ObjectDef).typenameValue;

      if (typename === undefined) {
        throw new Error(
          'Object definitions must have a typename to be in a union with other objects, records, or arrays',
        );
      }

      if (unionTypenameField !== undefined && typenameField !== unionTypenameField) {
        throw new Error('Object definitions must have the same typename field to be in the same union');
      }

      unionTypenameField = typenameField;
      shape[typename] = nestedDef as ObjectDef;
    }
  }

  def.typenameField = unionTypenameField;
  def.shapeKey = shapeKey >>> 0;
  def.mask = mask;

  return shape;
}

// -----------------------------------------------------------------------------
// Marker Functions
// -----------------------------------------------------------------------------

function defineTypename<T extends string>(value: T): T {
  return value;
}

function defineConst<T extends string | boolean | number>(value: T): Set<T> {
  return new Set([value]);
}

const defineEnum = (<T extends readonly (string | boolean | number)[]>(...values: T): Set<T[number]> => {
  return new Set(values as unknown as T[number][]);
}) as unknown as APITypes['enum'];

defineEnum.caseInsensitive = <T extends readonly (string | boolean | number)[]>(
  ...values: T
): CaseInsensitiveSet<T[number]> => {
  return new CaseInsensitiveSet(values as unknown as T[number][]);
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
): Formatted<SignaliumQuery.FormatRegistry[K]> {
  const mask = FORMAT_MAP.get(format);

  if (mask === undefined) {
    throw new Error(`Format ${format} not registered`);
  }

  return mask as Formatted<SignaliumQuery.FormatRegistry[K]>;
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

/**
 * Creates an entity definition with optional methods.
 *
 * @param shape - Lazy factory function that returns the entity's field definitions
 * @param methods - Optional lazy factory function that returns methods for the entity.
 *                  Methods have access to `this` typed as the reified entity shape.
 *                  Methods are wrapped with reactiveMethod for automatic caching.
 *
 * @example
 * const User = entity(
 *   () => ({
 *     __typename: t.typename('User'),
 *     id: t.id,
 *     name: t.string,
 *     age: t.number,
 *   }),
 *   () => ({
 *     greet() {
 *       return `Hello, ${this.name}!`;
 *     },
 *     isAdult() {
 *       return this.age >= 18;
 *     },
 *   })
 * );
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function entity<T extends ObjectShape, M extends EntityMethods = {}>(
  shape: () => T,
  methods?: () => M & ThisType<Prettify<ExtractTypesFromShape<T>>>,
  config?: EntityConfig<T>,
): EntityDef<T, M> {
  const def = new ValidatorDef(
    ComplexTypeDefKind.ENTITY,
    // The mask should be OBJECT | ENTITY so that values match when compared
    Mask.ENTITY | Mask.OBJECT,
    shape,
  );

  if (methods) {
    def._methodsFactory = methods as () => EntityMethods;
  }

  if (config) {
    def._entityConfig = config;
  }

  return def as unknown as EntityDef<T, M>;
}

export const t: APITypes = {
  format: defineFormatted,
  typename: defineTypename,
  const: defineConst,
  enum: defineEnum,
  id: Mask.ID | Mask.STRING | Mask.NUMBER,
  string: Mask.STRING,
  number: Mask.NUMBER,
  boolean: Mask.BOOLEAN,
  null: Mask.NULL,
  undefined: Mask.UNDEFINED,
  array: defineArray,
  object: defineObject,
  record: defineRecord,
  union: defineUnion,
  nullish: defineNullish,
  optional: defineOptional,
  nullable: defineNullable,
};
