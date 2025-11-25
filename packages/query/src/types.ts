import { PendingReactivePromise, ReadyReactivePromise } from 'signalium';
import { ReactivePromise } from 'signalium';
import { HasRequiredKeys, Optionalize, Prettify } from './type-utils.js';

// ================================
// Type Definitions
// ================================

export enum RefetchInterval {
  Every1Second = 1000,
  Every5Seconds = 5000,
  Every10Seconds = 10000,
  Every30Seconds = 30000,
  Every1Minute = 60000,
  Every5Minutes = 300000,
}

export enum NetworkMode {
  /**
   * Always fetch regardless of network status
   */
  Always = 'always',
  /**
   * Only fetch when online (default)
   */
  Online = 'online',
  /**
   * Fetch if cached data exists, even when offline
   */
  OfflineFirst = 'offlineFirst',
}

export interface RetryConfig {
  /**
   * Number of retry attempts
   */
  retries: number;
  /**
   * Optional custom delay function (receives attempt index starting at 0)
   * Default: exponential backoff (1000ms * 2^attempt)
   */
  retryDelay?: (attemptIndex: number) => number;
}

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
  shapeKey: number;
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
  shape: T;
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

  nullish: <T extends TypeDef>(type: T) => T | Mask.UNDEFINED | Mask.NULL;
  optional: <T extends TypeDef>(type: T) => T | Mask.UNDEFINED;
  nullable: <T extends TypeDef>(type: T) => T | Mask.NULL;
}

// ================================
// Type Extraction
// ================================

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
          : T extends Mask.ID
            ? string
            : never;

type ExtractTypesFromShape<S extends Record<string, ObjectFieldTypeDef>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

export type ExtractType<T extends ObjectFieldTypeDef> = T extends number
  ? ExtractPrimitiveTypeFromMask<T>
  : T extends string
    ? T
    : T extends Set<infer TSet>
      ? TSet
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

export type QueryType<T> = T extends () => infer Response ? (Response extends QueryResult<infer T> ? T : never) : never;

// ================================
// Query Types
// ================================

interface BaseQueryResultExtensions<T> {
  readonly isFetching: boolean;
  readonly isPaused: boolean;
}

interface QueryResultExtensions<T> extends BaseQueryResultExtensions<T> {
  refetch: () => Promise<T>;
  readonly isRefetching: boolean;
}

export type BaseQueryResult<T> = ReactivePromise<T> & QueryResultExtensions<T>;

export type PendingQueryResult<T> = PendingReactivePromise<T> & QueryResultExtensions<T>;

export type ReadyQueryResult<T> = ReadyReactivePromise<T> & QueryResultExtensions<T>;

export type QueryResult<T> = PendingQueryResult<T> | ReadyQueryResult<T>;

export type ResponseTypeDef = Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef;

export type ParamsOrUndefined<Params extends Record<string, unknown>> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends Params ? undefined : Params;

export type ExtractTypesFromObjectOrUndefined<S extends ResponseTypeDef> =
  S extends Record<string, ObjectFieldTypeDef>
    ? {
        [K in keyof S]: ExtractType<S[K]>;
      }
    : S extends ObjectFieldTypeDef
      ? ExtractType<S>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

export type QueryFn<Params extends Record<string, unknown>, Response extends ResponseTypeDef> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Params>>,
      ) => QueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>>
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Params>>>,
      ) => QueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>>;

// ================================
// Infinite Query Types
// ================================

interface InfiniteQueryResultExtensions<T> extends QueryResultExtensions<T> {
  fetchNextPage: () => Promise<T>;
  hasNextPage: boolean;
  isFetchingMore: boolean;
}

export type BaseInfiniteQueryResult<T> = ReactivePromise<T> & InfiniteQueryResultExtensions<T>;

export type PendingInfiniteQueryResult<T> = PendingReactivePromise<T> & InfiniteQueryResultExtensions<T>;

export type ReadyInfiniteQueryResult<T> = ReadyReactivePromise<T> & InfiniteQueryResultExtensions<T>;

export type InfiniteQueryResult<T> = PendingInfiniteQueryResult<T> | ReadyInfiniteQueryResult<T>;

export type InfiniteQueryFn<
  Params extends Record<string, unknown>,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Params>>,
      ) => InfiniteQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>[]>
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Params>>>,
      ) => InfiniteQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>[]>;

// ================================
// Stream Query Types
// ================================

type StreamQueryResultExtensions<T> = BaseQueryResultExtensions<T>;

export type BaseStreamQueryResult<T> = ReactivePromise<T> & StreamQueryResultExtensions<T>;

export type PendingStreamQueryResult<T> = PendingReactivePromise<T> & StreamQueryResultExtensions<T>;

export type ReadyStreamQueryResult<T> = ReadyReactivePromise<T> & StreamQueryResultExtensions<T>;

export type StreamQueryResult<T> = PendingStreamQueryResult<T> | ReadyStreamQueryResult<T>;

export type StreamQueryFn<
  Params extends Record<string, unknown>,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Params>>,
      ) => StreamQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>>
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Params>>>,
      ) => StreamQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrUndefined<Response>>>>;
