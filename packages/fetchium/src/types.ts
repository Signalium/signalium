import { DiscriminatedReactivePromise, type Signal } from 'signalium';
import { Prettify } from './type-utils.js';
import type { Query } from './query.js';

// ================================
// Base URL and Request Types
// ================================

/**
 * Flexible base URL value - can be a static string, a Signal, or a function.
 * Functions are wrapped in reactiveSignal internally for memoization.
 */
export type BaseUrlValue = string | Signal<string> | (() => string);

/**
 * Extended RequestInit with additional query-specific options.
 * This is what gets passed to the fetch function.
 */
export interface QueryRequestInit extends RequestInit {
  baseUrl?: string;
  searchParams?: URLSearchParams;
}

/**
 * Request options that can be specified at the query definition level.
 * These can override context-level settings.
 */
export interface QueryRequestOptions {
  baseUrl?: BaseUrlValue;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  mode?: RequestMode;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
}

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

// ================================
// Public Branded TypeDef
// ================================

declare const TypeDefSymbol: unique symbol;

/**
 * Branded phantom type representing a type definition in the public API.
 * At runtime, values are Masks, Sets, ValidatorDefs, etc. but the type system
 * sees them as TypeDef<T> where T is the extracted TypeScript type.
 */
export type TypeDef<T = unknown> = T & { readonly [TypeDefSymbol]: T };

// ================================
// Internal Type Definitions
// ================================

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

export type InternalTypeDef = SimpleTypeDef | ComplexTypeDef;

export type InternalObjectFieldTypeDef = InternalTypeDef | string;

export type InternalObjectShape = Record<string, InternalObjectFieldTypeDef>;

export const ARRAY_KEY = Symbol('array');
export const RECORD_KEY = Symbol('record');

export interface UnionTypeDefs {
  [ARRAY_KEY]?: InternalTypeDef;
  [RECORD_KEY]?: InternalTypeDef;
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
}

export type EntityMethods = Record<string, (...args: any[]) => any>;

// Helper type to conditionally include methods - unknown (invisible) when M is the default EntityMethods
// We check if M has an index signature by seeing if it allows any string key
export type IncludeMethods<M> = string extends keyof M ? unknown : M;

// Entity configuration options
export interface EntityConfig<T extends Record<string, TypeDef>> {
  stream: {
    subscribe: (
      context: import('./QueryClient.js').QueryContext,
      id: string | number,
      onUpdate: (update: Partial<ExtractTypesFromShape<T>>) => void,
    ) => (() => void) | undefined;
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EntityDef<T extends InternalObjectShape = InternalObjectShape, M extends EntityMethods = {}>
  extends BaseTypeDef {
  mask: Mask.ENTITY;
  shape: T;
}

export interface ObjectDef<T extends InternalObjectShape = InternalObjectShape> extends BaseTypeDef {
  mask: Mask.OBJECT;
  shape: T;
}

export interface ArrayDef<T extends InternalTypeDef = InternalTypeDef> extends BaseTypeDef {
  mask: Mask.ARRAY;
  shape: T;
}

export interface UnionDef<_T extends readonly InternalTypeDef[] = readonly InternalTypeDef[]> extends BaseTypeDef {
  mask: Mask.UNION;
  shape: UnionTypeDefs | undefined;
}

export interface RecordDef<T extends InternalTypeDef = InternalTypeDef> extends BaseTypeDef {
  mask: Mask.RECORD;
  shape: T;
}

export interface ParseResultDef<T extends InternalTypeDef = InternalTypeDef> extends BaseTypeDef {
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
  format: <K extends keyof SignaliumQuery.FormatRegistry>(format: K) => TypeDef<SignaliumQuery.FormatRegistry[K]>;
  typename: <T extends string>(value: T) => TypeDef<T>;
  const: <T extends string | boolean | number>(value: T) => TypeDef<T>;
  enum: {
    <T extends readonly (string | boolean | number)[]>(...values: T): TypeDef<T[number]>;
    caseInsensitive<T extends readonly (string | boolean | number)[]>(...values: T): TypeDef<T[number]>;
  };

  id: TypeDef<string | number>;
  string: TypeDef<string>;
  number: TypeDef<number>;
  boolean: TypeDef<boolean>;
  null: TypeDef<null>;
  undefined: TypeDef<undefined>;

  array: <T extends TypeDef>(shape: T) => TypeDef<ExtractType<T>[]>;
  object: <T extends Record<string, TypeDef>>(shape: T) => TypeDef<Prettify<ExtractTypesFromShape<T>>>;
  record: <T extends TypeDef>(shape: T) => TypeDef<Record<string, ExtractType<T>>>;
  union: <VS extends readonly TypeDef[]>(...types: VS) => TypeDef<ExtractType<VS[number]>>;

  nullish: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | undefined | null>;
  optional: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | undefined>;
  nullable: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | null>;

  result: <T extends TypeDef>(type: T) => TypeDef<ParseResult<ExtractType<T>>>;

  entity: <T extends import('./proxy.js').Entity>(cls: new () => T) => TypeDef<T>;
}

// ================================
// Type Extraction
// ================================

export type ExtractType<T> = T extends TypeDef<infer U> ? U : never;

export type ExtractTypesFromShape<S extends Record<string, TypeDef>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

export type ResponseTypeDef = Record<string, TypeDef> | TypeDef;

export type ParamsOrUndefined<Params extends Record<string, unknown>> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends Params ? undefined : Params;

export type ExtractTypesFromObjectOrEntity<S extends ResponseTypeDef> =
  S extends TypeDef<infer T>
    ? T
    : S extends Record<string, TypeDef>
      ? { [K in keyof S]: ExtractType<S[K]> }
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

export type ExtractTypesFromEntityOrUndefined<S extends TypeDef | undefined = undefined> =
  S extends TypeDef<infer T> ? T : undefined;

// ================================
// Query Types
// ================================

export type QueryResult<T extends Query> = ExtractTypesFromObjectOrEntity<T['response']> & {
  __refetch(): Promise<QueryResult<T>>;
};

export type QueryPromise<T extends Query> = DiscriminatedReactivePromise<QueryResult<T>>;

// ================================
// Mutation Types
// ================================

export type ParseAndApply = 'both' | 'request' | 'response' | 'none';

export type MutationResultValue<Response> = Response;
