import {
  APITypes,
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  Mask,
  ObjectDef,
  ObjectShape,
  RECORD_KEY,
  RecordDef,
  TypeDef,
  ObjectFieldTypeDef,
  UnionDef,
  UnionTypeDefs,
} from './types.js';
import { extractShape, extractShapeMetadata } from './utils.js';

export class ValidatorDef<T> {
  private _optional: ValidatorDef<T | undefined> | undefined;
  private _nullable: ValidatorDef<T | null> | undefined;
  private _nullish: ValidatorDef<T | null | undefined> | undefined;

  constructor(
    public mask: Mask,
    public shape: ObjectFieldTypeDef | ObjectShape | ((t: APITypes) => ObjectShape) | UnionTypeDefs | undefined,
    public subEntityPaths: undefined | string | string[] = undefined,
    public values: Set<string | boolean | number> | undefined = undefined,
    public typenameField: string | undefined = undefined,
    public typenameValue: string | undefined = undefined,
    public idField: string | undefined = undefined,
  ) {}

  get optional(): ValidatorDef<T | undefined> {
    if (this._optional === undefined) {
      this._optional = new ValidatorDef(
        this.mask | Mask.UNDEFINED,
        this.shape,
        this.subEntityPaths,
        this.values,
        this.typenameField,
        this.typenameValue,
        this.idField,
      );
    }
    return this._optional;
  }

  get nullable(): ValidatorDef<T | null> {
    if (this._nullable === undefined) {
      this._nullable = new ValidatorDef(
        this.mask | Mask.NULL,
        this.shape,
        this.subEntityPaths,
        this.values,
        this.typenameField,
        this.typenameValue,
        this.idField,
      );
    }
    return this._nullable;
  }

  get nullish(): ValidatorDef<T | null | undefined> {
    if (this._nullish === undefined) {
      this._nullish = new ValidatorDef(
        this.mask | Mask.UNDEFINED | Mask.NULL,
        this.shape,
        this.subEntityPaths,
        this.values,
        this.typenameField,
        this.typenameValue,
        this.idField,
      );
    }
    return this._nullish;
  }
}

// -----------------------------------------------------------------------------
// Complex Type Definitions
// -----------------------------------------------------------------------------

export function defineArray<T extends TypeDef>(shape: T): ArrayDef<T> {
  let mask = Mask.ARRAY;

  // Propagate HAS_SUB_ENTITY flag if the shape contains entities
  if (shape instanceof ValidatorDef && (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
    mask |= Mask.HAS_SUB_ENTITY;
  }

  return new ValidatorDef(mask, shape) as unknown as ArrayDef<T>;
}

export function defineRecord<T extends TypeDef>(shape: T): RecordDef<T> {
  // The mask should be OBJECT | RECORD so that values match when compared
  let mask = Mask.RECORD | Mask.OBJECT;

  // Propagate HAS_SUB_ENTITY flag if the shape contains entities
  if (shape instanceof ValidatorDef && (shape.mask & (Mask.ENTITY | Mask.HAS_SUB_ENTITY)) !== 0) {
    mask |= Mask.HAS_SUB_ENTITY;
  }

  return new ValidatorDef(mask, shape) as unknown as RecordDef<T>;
}

export function defineObject<T extends ObjectShape>(shape: T): ObjectDef<T> {
  const def = new ValidatorDef(Mask.OBJECT, shape);

  extractShapeMetadata(def, shape);

  return def as unknown as ObjectDef<T>;
}

const addShapeToUnion = (
  shape: UnionTypeDefs,
  definition: ObjectDef | EntityDef | RecordDef | UnionDef | ArrayDef,
  unionTypenameField: string | undefined,
) => {
  const mask = definition.mask;

  if ((mask & Mask.UNION) !== 0) {
    // Merge nested union into parent union
    const nestedUnion = definition as UnionDef;

    // Check typename field consistency
    if (nestedUnion.typenameField !== undefined) {
      if (unionTypenameField !== undefined && unionTypenameField !== nestedUnion.typenameField) {
        throw new Error(
          `Union typename field conflict: Cannot merge unions with different typename fields ('${unionTypenameField}' vs '${nestedUnion.typenameField}')`,
        );
      }
      unionTypenameField = nestedUnion.typenameField;
    }

    // Merge nested union's shape into parent
    if (nestedUnion.shape !== undefined) {
      for (const key of [...Object.keys(nestedUnion.shape), ARRAY_KEY, RECORD_KEY] as const) {
        // Check for conflicts
        const value = nestedUnion.shape[key];

        if (shape[key] !== undefined && shape[key] !== value) {
          throw new Error(
            `Union merge conflict: Duplicate typename value '${String(key)}' found when merging nested unions`,
          );
        }

        // coerce type because we know the value is the same type as the key
        shape[key] = value as any;
      }
    }

    return unionTypenameField;
  } else if ((mask & Mask.ARRAY) !== 0) {
    if (shape[ARRAY_KEY] !== undefined) {
      throw new Error('Array shape already defined');
    }

    shape[ARRAY_KEY] = definition.shape as TypeDef;

    return unionTypenameField;
  } else if ((mask & Mask.RECORD) !== 0) {
    if (shape[RECORD_KEY] !== undefined) {
      throw new Error('Record shape already defined');
    }

    shape[RECORD_KEY] = definition.shape as TypeDef;

    return unionTypenameField;
  } else {
    // Make sure the type is fully extracted, so we can get the typename field and value
    extractShape(definition);

    // definition is ObjectDef | EntityDef
    const typenameField = (definition as ObjectDef).typenameField;
    const typename = (definition as ObjectDef).typenameValue;

    if (typename === undefined) {
      throw new Error(
        'Object definitions must have a typename to be in a union with other objects, records, or arrays',
      );
    }

    if (unionTypenameField !== undefined && typenameField !== unionTypenameField) {
      throw new Error('Object definitions must have the same typename field to be in the same union');
    }

    shape[typename] = definition as ObjectDef;

    return typenameField;
  }
};

function defineUnion<T extends readonly TypeDef[]>(...types: T): UnionDef<T> {
  let mask = 0;
  let definition: ObjectDef | EntityDef | RecordDef | UnionDef | ArrayDef | undefined;
  let shape: UnionTypeDefs | undefined;
  let values: Set<string | boolean | number> | undefined;
  let unionTypenameField: string | undefined;

  for (const type of types) {
    if (typeof type === 'number') {
      mask |= type;
      continue;
    }

    const isSet = type instanceof Set;
    const typeValues = isSet ? type : type.values;

    // Handle Set-based constants/enums
    if (typeValues !== undefined) {
      if (values === undefined) {
        values = new Set(typeValues);
      } else {
        for (const val of typeValues) {
          values.add(val);
        }
      }

      if (isSet) {
        continue;
      }
    }

    // We know it's a complex type at this point because if it was a Set,
    // we would have already handled it above.
    const typeDef = type as ComplexTypeDef;

    mask |= typeDef.mask;

    if (definition === undefined) {
      definition = typeDef;
      continue;
    }

    if (shape === undefined) {
      shape = Object.create(null) as UnionTypeDefs;

      unionTypenameField = addShapeToUnion(shape, definition, unionTypenameField);
    }

    unionTypenameField = addShapeToUnion(shape, typeDef, unionTypenameField);
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

  return new ValidatorDef(
    mask | Mask.UNION,
    shape ?? definition?.shape,
    undefined,
    values,
    unionTypenameField,
  ) as UnionDef;
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

function defineEnum<T extends readonly (string | boolean | number)[]>(...values: T): Set<T[number]> {
  return new Set(values as unknown as T[number][]);
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

export function getFormat(mask: number): (value: unknown) => unknown {
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
// Entity Definitions
// -----------------------------------------------------------------------------

export function entity<T extends ObjectShape>(shape: (t: APITypes) => T): EntityDef<T> {
  return new ValidatorDef(
    // The mask should be OBJECT | ENTITY so that values match when compared
    Mask.ENTITY | Mask.OBJECT,
    shape,
  ) as unknown as EntityDef<T>;
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
};
