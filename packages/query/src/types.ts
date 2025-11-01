import { PendingReactivePromise, ReadyReactivePromise } from 'signalium';
import { ReactivePromise } from 'signalium';

export const enum Mask {
  // Fundamental types
  UNDEFINED = 1 << 0,
  NULL = 1 << 1,
  NUMBER = 1 << 2,
  STRING = 1 << 3,
  BOOLEAN = 1 << 4,
  OBJECT = 1 << 5,
  ARRAY = 1 << 6,
  ID = 1 << 7,

  // Complex types
  RECORD = 1 << 8,
  UNION = 1 << 9,
  ENTITY = 1 << 10,

  // Flags
  HAS_SUB_ENTITY = 1 << 11,
  HAS_NUMBER_FORMAT = 1 << 12,
  HAS_STRING_FORMAT = 1 << 13,
}

export type SimpleTypeDef =
  // Sets are constant values
  | Set<string | boolean | number>

  // Numbers are primitive type masks (potentially multiple masks combined)
  | Mask;

export type ComplexTypeDef =
  // Objects, arrays, records, and unions are definitions
  ObjectDef | EntityDef | ArrayDef | RecordDef | UnionDef;

export type TypeDef = SimpleTypeDef | ComplexTypeDef;

export type ObjectFieldTypeDef = TypeDef | string;

export type ObjectShape = Record<string, ObjectFieldTypeDef>;

export const ARRAY_KEY = Symbol('array');
export const RECORD_KEY = Symbol('record');

export interface UnionTypeDefs {
  [ARRAY_KEY]?: TypeDef;
  [RECORD_KEY]?: TypeDef;
  [key: string]: ObjectDef | EntityDef;
}

export interface BaseTypeDef {
  mask: Mask;
  typenameField: string;
  typenameValue: string;
  idField: string;
  subEntityPaths: undefined | string | string[];
  values: Set<string | boolean | number> | undefined;

  optional: this | Mask.UNDEFINED;
  nullable: this | Mask.NULL;
  nullish: this | Mask.UNDEFINED | Mask.NULL;
}

export interface EntityDef<T extends ObjectShape = ObjectShape> extends BaseTypeDef {
  mask: Mask.ENTITY;
  shape: T | ((t: APITypes) => T);
}

export interface ObjectDef<T extends ObjectShape = ObjectShape> extends BaseTypeDef {
  mask: Mask.OBJECT;
  shape: T;
}

export interface ArrayDef<T extends TypeDef = TypeDef> extends BaseTypeDef {
  mask: Mask.ARRAY;
  shape: T;
}

export interface UnionDef<_T extends readonly TypeDef[] = readonly TypeDef[]> extends BaseTypeDef {
  mask: Mask.UNION;
  shape: UnionTypeDefs | undefined;
}

export interface RecordDef<T extends TypeDef = TypeDef> extends BaseTypeDef {
  mask: Mask.RECORD;
  shape: T;
}

export interface APITypes {
  format: (format: string) => number;
  typename: <T extends string>(value: T) => T;
  const: <T extends string | boolean | number>(value: T) => Set<T>;
  enum: <T extends readonly (string | boolean | number)[]>(...values: T) => Set<T[number]>;

  id: Mask.ID;
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

type QueryResultExtensions<T> = {
  refetch: () => Promise<T>;
};

export type QueryResult<T> = ReactivePromise<T> & QueryResultExtensions<T>;

export type PendingQueryResult<T> = PendingReactivePromise<T> & QueryResultExtensions<T>;

export type ReadyQueryResult<T> = ReadyReactivePromise<T> & QueryResultExtensions<T>;

export type DiscriminatedQueryResult<T> = PendingQueryResult<T> | ReadyQueryResult<T>;
