import { PendingReactivePromise, ReadyReactivePromise, type Signal } from 'signalium';
import { ReactivePromise } from 'signalium';
import { HasRequiredKeys, Optionalize, Prettify, Signalize } from './type-utils.js';

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
  PARSE_RESULT = 1 << 14,
}

// ================================
// ParseResult Types
// ================================

export type ParseSuccess<T> = { success: true; value: T };
export type ParseError = { success: false; error: Error };
export type ParseResult<T> = ParseSuccess<T> | ParseError;

/**
 * Interface for case-insensitive enum sets.
 * String values are matched case-insensitively during parsing,
 * but always return the canonical (originally defined) casing.
 */
export interface CaseInsensitiveEnumSet<T extends string | boolean | number> extends Set<T> {
  /**
   * Check if a value exists in the set (case-insensitively for strings).
   */
  has(value: unknown): boolean;

  /**
   * Get the canonical value for a given input.
   * For strings, performs case-insensitive lookup and returns the canonical casing.
   * For numbers/booleans, performs exact match.
   * Returns undefined if no match is found.
   */
  get(value: unknown): T | undefined;
}

export type SimpleTypeDef =
  // Sets are constant values
  | Set<string | boolean | number>

  // Case-insensitive enum sets
  | CaseInsensitiveEnumSet<string | boolean | number>

  // Numbers are primitive type masks (potentially multiple masks combined)
  | Mask;

export type ComplexTypeDef =
  // Objects, arrays, records, unions, and parse results are definitions
  ObjectDef | EntityDef | ArrayDef | RecordDef | UnionDef | ParseResultDef;

export type TypeDef = SimpleTypeDef | ComplexTypeDef;

export type ObjectFieldTypeDef = TypeDef | string;

export type ObjectShape = Record<string, ObjectFieldTypeDef>;

// ================================
// Extend Type Utilities
// ================================

/**
 * Utility type that prevents extending with keys that already exist in T.
 * If U contains a key from T, that key's type becomes `never`, causing a type error.
 */
export type StrictExtend<T extends ObjectShape, U extends ObjectShape> = {
  [K in keyof U]: K extends keyof T ? never : U[K];
};

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

export type EntityMethods = Record<string, (...args: any[]) => any>;

// Helper type to conditionally include methods - unknown (invisible) when M is the default EntityMethods
// We check if M has an index signature by seeing if it allows any string key
export type IncludeMethods<M> = string extends keyof M ? unknown : M;

// Entity configuration options
export interface EntityConfig<T extends ObjectShape> {
  stream: {
    subscribe: (
      context: import('./QueryClient.js').QueryContext,
      id: string | number,
      onUpdate: (update: Partial<ExtractTypesFromShape<T>>) => void,
    ) => (() => void) | undefined;
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EntityDef<T extends ObjectShape = ObjectShape, M extends EntityMethods = {}> extends BaseTypeDef {
  mask: Mask.ENTITY;
  shape: T;

  /**
   * Creates a new EntityDef that extends this one with additional fields and optional methods.
   * The function is called lazily on first shape access to support circular references.
   * Prevents overriding of existing fields including id and typename.
   *
   * @param newFieldsGetter - Lazy factory returning new fields to add
   * @param newMethodsGetter - Optional lazy factory returning new methods to add (merged with existing)
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  extend<U extends ObjectShape, N extends EntityMethods = {}>(
    newFieldsGetter: () => StrictExtend<T, U> & U,
    newMethodsGetter?: () => N & ThisType<N & ExtractTypesFromShape<T & U> & IncludeMethods<M>>,
  ): EntityDef<T & U, M & N>;
}

export interface ObjectDef<T extends ObjectShape = ObjectShape> extends BaseTypeDef {
  mask: Mask.OBJECT;
  shape: T;
  /**
   * Creates a new ObjectDef that extends this one with additional fields.
   * Prevents overriding of existing fields including id and typename.
   */
  extend<U extends ObjectShape>(newFields: StrictExtend<T, U> & U): ObjectDef<T & U>;
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

export interface ParseResultDef<T extends TypeDef = TypeDef> extends BaseTypeDef {
  mask: Mask.PARSE_RESULT;
  shape: T;
}

/**
 * Global format registry interface that maps format names to their TypeScript types.
 * This can be extended via module augmentation using the SignaliumQuery namespace.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SignaliumQuery {
    interface FormatRegistry {
      date: Date;
      'date-time': Date;
      // Users can extend this via module augmentation
      // Example: declare global { namespace SignaliumQuery { interface FormatRegistry { 'custom-format': CustomType } } }
    }
  }
}

declare const FormattedSymbol: unique symbol;

export type Formatted<T> = number & {
  [FormattedSymbol]: T;
};

export interface APITypes {
  format: <K extends keyof SignaliumQuery.FormatRegistry>(format: K) => Formatted<SignaliumQuery.FormatRegistry[K]>;
  typename: <T extends string>(value: T) => T;
  const: <T extends string | boolean | number>(value: T) => Set<T>;
  enum: {
    <T extends readonly (string | boolean | number)[]>(...values: T): Set<T[number]>;
    caseInsensitive<T extends readonly (string | boolean | number)[]>(...values: T): Set<T[number]>;
  };

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

  result: <T extends TypeDef>(type: T) => ParseResultDef<T>;
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
            ? string | number
            : never;

export type ExtractTypesFromShape<S extends Record<string, ObjectFieldTypeDef>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

export type ExtractType<T extends ObjectFieldTypeDef> =
  T extends Formatted<infer U>
    ? U
    : T extends number
      ? ExtractPrimitiveTypeFromMask<T>
      : T extends string
        ? T
        : T extends Set<infer TSet>
          ? TSet
          : T extends ObjectDef<infer S>
            ? Prettify<ExtractTypesFromShape<S>>
            : T extends EntityDef<infer S, infer M>
              ? Prettify<ExtractTypesFromShape<S> & IncludeMethods<M>>
              : T extends ArrayDef<infer S>
                ? ExtractType<S>[]
                : T extends RecordDef<infer S>
                  ? Record<string, ExtractType<S>>
                  : T extends UnionDef<infer VS>
                    ? ExtractType<VS[number]>
                    : T extends ParseResultDef<infer S>
                      ? ParseResult<ExtractType<S>>
                      : never;

export type QueryType<T> = T extends () => infer Response
  ? Response extends QueryResult<infer T, unknown, unknown>
    ? T
    : never
  : never;

export type ResponseTypeDef = Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef;

export type ParamsOrUndefined<Params extends Record<string, unknown>> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends Params ? undefined : Params;

export type ExtractTypesFromObjectOrEntity<S extends ResponseTypeDef> =
  S extends Record<string, ObjectFieldTypeDef>
    ? {
        [K in keyof S]: ExtractType<S[K]>;
      }
    : S extends ObjectFieldTypeDef
      ? ExtractType<S>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

export type ExtractTypesFromEntityOrUndefined<S extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined> =
  S extends EntityDef<infer Shape, infer Methods>
    ? Prettify<ExtractTypesFromShape<Shape> & IncludeMethods<Methods>>
    : S extends UnionDef<infer VS>
      ? ExtractType<VS[number]>
      : undefined;

// ================================
// Query Extra Types
// ================================

export type QueryExtra<StreamType, OptimisticInsertType> = {
  streamOrphans: StreamType extends undefined ? undefined : ReadonlySet<StreamType>;
  optimisticInserts: OptimisticInsertType extends undefined ? undefined : ReadonlySet<OptimisticInsertType>;
};

// ================================
// Query Types
// ================================

interface BaseQueryResultExtensions<T, StreamType, OptimisticUpdateType> {
  readonly isFetching: boolean;
  readonly isPaused: boolean;
  readonly extra: QueryExtra<StreamType, OptimisticUpdateType>;
}

interface QueryResultExtensions<T, StreamType, OptimisticUpdateType>
  extends BaseQueryResultExtensions<T, StreamType, OptimisticUpdateType> {
  refetch: () => Promise<T>;
  readonly isRefetching: boolean;
}

export type BaseQueryResult<T, StreamType, OptimisticUpdateType> = ReactivePromise<T> &
  QueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type PendingQueryResult<T, StreamType, OptimisticUpdateType> = PendingReactivePromise<T> &
  QueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type ReadyQueryResult<T, StreamType, OptimisticUpdateType> = ReadyReactivePromise<T> &
  QueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type QueryResult<T, StreamType = undefined, OptimisticUpdateType = undefined> =
  | PendingQueryResult<T, StreamType, OptimisticUpdateType>
  | ReadyQueryResult<T, StreamType, OptimisticUpdateType>;

export type QueryFn<
  Params extends Record<string, unknown>,
  Response extends ResponseTypeDef,
  StreamType extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticUpdateType extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Signalize<Params>>>,
      ) => QueryResult<
        Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<StreamType>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<OptimisticUpdateType>>>
      >
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Signalize<Params>>>>,
      ) => QueryResult<
        Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<StreamType>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<OptimisticUpdateType>>>
      >;

// ================================
// Infinite Query Types
// ================================

interface InfiniteQueryResultExtensions<T, StreamType, OptimisticUpdateType>
  extends QueryResultExtensions<T, StreamType, OptimisticUpdateType> {
  fetchNextPage: () => Promise<T>;
  hasNextPage: boolean;
  isFetchingMore: boolean;
}

export type BaseInfiniteQueryResult<T, StreamType, OptimisticUpdateType> = ReactivePromise<T> &
  InfiniteQueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type PendingInfiniteQueryResult<T, StreamType, OptimisticUpdateType> = PendingReactivePromise<T> &
  InfiniteQueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type ReadyInfiniteQueryResult<T, StreamType, OptimisticUpdateType> = ReadyReactivePromise<T> &
  InfiniteQueryResultExtensions<T, StreamType, OptimisticUpdateType>;

export type InfiniteQueryResult<T, StreamType = undefined, OptimisticUpdateType = undefined> =
  | PendingInfiniteQueryResult<T, StreamType, OptimisticUpdateType>
  | ReadyInfiniteQueryResult<T, StreamType, OptimisticUpdateType>;

export type InfiniteQueryFn<
  Params extends Record<string, unknown>,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
  StreamType extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticUpdateType extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Signalize<Params>>>,
      ) => InfiniteQueryResult<
        Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>[],
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<StreamType>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<OptimisticUpdateType>>>
      >
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Signalize<Params>>>>,
      ) => InfiniteQueryResult<
        Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>[],
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<StreamType>>>,
        Readonly<Prettify<ExtractTypesFromEntityOrUndefined<OptimisticUpdateType>>>
      >;

// ================================
// Stream Query Types
// ================================

type StreamQueryResultExtensions<T> = BaseQueryResultExtensions<T, undefined, undefined>;

export type BaseStreamQueryResult<T> = ReactivePromise<T> & StreamQueryResultExtensions<T>;

export type PendingStreamQueryResult<T> = PendingReactivePromise<T> & StreamQueryResultExtensions<T>;

export type ReadyStreamQueryResult<T> = ReadyReactivePromise<T> & StreamQueryResultExtensions<T>;

export type StreamQueryResult<T> = PendingStreamQueryResult<T> | ReadyStreamQueryResult<T>;

export type StreamQueryFn<Params extends Record<string, unknown>, Response extends EntityDef | UnionDef<EntityDef[]>> =
  HasRequiredKeys<Params> extends true
    ? (
        params: Prettify<Optionalize<Params>>,
      ) => StreamQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>>
    : (
        params?: Prettify<Optionalize<ParamsOrUndefined<Params>>>,
      ) => StreamQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrEntity<Response>>>>;
