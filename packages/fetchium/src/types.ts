import { DiscriminatedReactivePromise, type Signal } from 'signalium';
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
  HAS_FORMAT = 1 << 12,
  IS_EAGER_FORMAT = 1 << 13,
  PARSE_RESULT = 1 << 14,
  LIVE = 1 << 15,
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

export declare const TypeDefSymbol: unique symbol;

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
export const QUERY_ID = Symbol('QUERY_ID');

export interface UnionTypeDefs {
  [ARRAY_KEY]?: InternalTypeDef;
  [RECORD_KEY]?: InternalTypeDef;
  [key: string]: ObjectDef | EntityDef;
}

export interface BaseTypeDef {
  mask: Mask;
  typenameField: string;
  typenameValue: string;
  idField: string | symbol;
  values: Set<string | boolean | number> | undefined;
}

export type EntityMethods = Record<string, (...args: any[]) => any>;

// Entity configuration options
export interface EntityConfig {
  hasSubscribe: boolean;
}

export interface EntityDef<T extends InternalObjectShape = InternalObjectShape> extends BaseTypeDef {
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
  object: <T extends TypeDefShape>(shape: T) => TypeDef<ExtractType<T>>;
  record: <T extends TypeDef>(shape: T) => TypeDef<Record<string, ExtractType<T>>>;
  union: <VS extends readonly TypeDef[]>(...types: VS) => TypeDef<ExtractType<VS[number]>>;

  nullish: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | undefined | null>;
  optional: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | undefined>;
  nullable: <T extends TypeDef>(type: T) => TypeDef<ExtractType<T> | null>;

  result: <T extends TypeDef>(type: T) => TypeDef<ParseResult<ExtractType<T>>>;

  entity: <T extends import('./proxy.js').Entity>(cls: new () => T) => TypeDef<T>;

  liveArray: {
    <E extends import('./proxy.js').Entity>(entity: new () => E, opts?: LiveArrayOptions<E>): TypeDef<E[]>;
    <E extends import('./proxy.js').Entity>(entities: (new () => E)[], opts?: LiveArrayOptions<E>): TypeDef<E[]>;
  };

  liveValue: {
    <V, E extends import('./proxy.js').Entity>(
      type: TypeDef<V>,
      entity: new () => E,
      opts: LiveValueOptions<V, E>,
    ): TypeDef<V>;
    <V, E extends import('./proxy.js').Entity>(
      type: TypeDef<V>,
      entities: (new () => E)[],
      opts: LiveValueOptions<V, E>,
    ): TypeDef<V>;
  };
}

// ================================
// Type Extraction
// ================================

type IsAny<T> = 0 extends 1 & T ? true : false;

export type ExtractType<T> =
  IsAny<T> extends true
    ? any
    : T extends TypeDef<infer U>
      ? ExtractType<U>
      : T extends (...args: infer V) => infer Q
        ? (...args: V) => ExtractType<Q>
        : T extends object
          ? { [K in keyof T]: ExtractType<T[K]> }
          : T;

export type TypeDefShape = Record<string, TypeDef> | TypeDef;

// ================================
// Query Types
// ================================

export type QueryResult<T extends Query> = ExtractType<T['result']> & {
  __refetch(): DiscriminatedReactivePromise<QueryResult<T>>;
  __loadNext(): Promise<QueryResult<T>>;
  __hasNext: boolean;
  __isLoadingNext: boolean;
};

export type QueryPromise<T extends Query> = DiscriminatedReactivePromise<QueryResult<T>>;

// ================================
// Mutation Events
// ================================

export interface CreateEvent {
  type: 'create';
  typename: string;
  data: Record<string, unknown>;
  id?: unknown;
  __eventSource?: number;
}

export interface UpdateEvent {
  type: 'update';
  typename: string;
  data: Record<string, unknown>;
  id?: unknown;
  __eventSource?: number;
}

export interface DeleteEvent {
  type: 'delete';
  typename: string;
  data: string | number | Record<string, unknown>;
  id?: unknown;
  __eventSource?: number;
}

export type MutationEvent = CreateEvent | UpdateEvent | DeleteEvent;

// ================================
// LiveArray / LiveValue
// ================================

export type ConstraintMap = Record<string, unknown>;

export type ConstraintDef<E extends import('./proxy.js').Entity> = ConstraintMap | Array<[new () => E, ConstraintMap]>;

export interface LiveArrayOptions<E extends import('./proxy.js').Entity> {
  constraints?: ConstraintDef<E>;
  sort?: (a: E, b: E) => number;
}

export interface LiveValueOptions<V, E extends import('./proxy.js').Entity> {
  constraints?: ConstraintDef<E>;
  onCreate: (value: V, entity: E) => V;
  onUpdate: (value: V, entity: E) => V;
  onDelete: (value: V, entity: E) => V;
}

export const enum LiveFieldType {
  Array = 0,
  Value = 1,
}

export class LiveFieldConfig {
  type: LiveFieldType;
  entityDefs: import('./typeDefs.js').ValidatorDef<any>[];
  constraintFieldRefs: Map<string, Array<[string, unknown]>> | undefined;
  sort: ((a: unknown, b: unknown) => number) | undefined;
  valueType: InternalTypeDef | undefined;
  onCreate: ((value: unknown, entity: unknown) => unknown) | undefined;
  onUpdate: ((value: unknown, entity: unknown) => unknown) | undefined;
  onDelete: ((value: unknown, entity: unknown) => unknown) | undefined;

  constructor(
    type: LiveFieldType,
    entityDefs: import('./typeDefs.js').ValidatorDef<any>[],
    constraintFieldRefs: Map<string, Array<[string, unknown]>> | undefined,
    sort: ((a: unknown, b: unknown) => number) | undefined,
    valueType: InternalTypeDef | undefined,
    onCreate: ((value: unknown, entity: unknown) => unknown) | undefined,
    onUpdate: ((value: unknown, entity: unknown) => unknown) | undefined,
    onDelete: ((value: unknown, entity: unknown) => unknown) | undefined,
  ) {
    this.type = type;
    this.entityDefs = entityDefs;
    this.constraintFieldRefs = constraintFieldRefs;
    this.sort = sort;
    this.valueType = valueType;
    this.onCreate = onCreate;
    this.onUpdate = onUpdate;
    this.onDelete = onDelete;
  }

  static array(
    entityDefs: import('./typeDefs.js').ValidatorDef<any>[],
    constraintFieldRefs: Map<string, Array<[string, unknown]>> | undefined,
    sort?: (a: unknown, b: unknown) => number,
  ): LiveFieldConfig {
    return new LiveFieldConfig(
      LiveFieldType.Array,
      entityDefs,
      constraintFieldRefs,
      sort,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  }

  static value(
    entityDefs: import('./typeDefs.js').ValidatorDef<any>[],
    constraintFieldRefs: Map<string, Array<[string, unknown]>> | undefined,
    valueType: InternalTypeDef,
    onCreate: (value: unknown, entity: unknown) => unknown,
    onUpdate: (value: unknown, entity: unknown) => unknown,
    onDelete: (value: unknown, entity: unknown) => unknown,
  ): LiveFieldConfig {
    return new LiveFieldConfig(
      LiveFieldType.Value,
      entityDefs,
      constraintFieldRefs,
      undefined,
      valueType,
      onCreate,
      onUpdate,
      onDelete,
    );
  }
}

// ================================
// Mutation Effects
// ================================

export type EntityClassOrTypename = string | (new () => import('./proxy.js').Entity);

export interface MutationEffects {
  readonly creates?: ReadonlyArray<readonly [EntityClassOrTypename, unknown]>;
  readonly updates?: ReadonlyArray<readonly [EntityClassOrTypename, unknown]>;
  readonly deletes?: ReadonlyArray<readonly [EntityClassOrTypename, unknown]>;
}
