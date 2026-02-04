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

import { context, type Context } from 'signalium';
import { hashValue } from 'signalium/utils';
import {
  QueryResult,
  EntityDef,
  RefetchInterval,
  NetworkMode,
  RetryConfig,
  TypeDef,
  UnionDef,
  BaseUrlValue,
  QueryRequestInit,
  MutationResult,
} from './types.js';
import { EntityRecord, EntityStore } from './EntityMap.js';
import { NetworkManager } from './NetworkManager.js';
import { QueryResultImpl } from './QueryResult.js';
import { MutationResultImpl } from './MutationResult.js';
import { MutationDefinition } from './mutation.js';
import { RefetchManager } from './RefetchManager.js';
import { MemoryEvictionManager } from './MemoryEvictionManager.js';
import { type Signal } from 'signalium';

// -----------------------------------------------------------------------------
// Query Types
// -----------------------------------------------------------------------------

export interface QueryContext {
  fetch: (url: string, init?: QueryRequestInit) => Promise<Response>;
  baseUrl?: BaseUrlValue;
  log?: {
    error?: (message: string, error?: unknown) => void;
    warn?: (message: string, error?: unknown) => void;
    info?: (message: string) => void;
    debug?: (message: string) => void;
  };
  evictionMultiplier?: number;
  refetchMultiplier?: number;
}

/**
 * Resolves a BaseUrlValue to a string.
 * Handles static strings, Signals, and functions.
 */
export function resolveBaseUrl(baseUrl: BaseUrlValue | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  if (typeof baseUrl === 'string') return baseUrl;
  if (typeof baseUrl === 'function') return baseUrl();
  return baseUrl.value; // Signal
}

export interface QueryCacheOptions {
  maxCount?: number;
  gcTime?: number; // milliseconds - only applies to on-disk/persistent storage cleanup
  staleTime?: number;
  refetchInterval?: RefetchInterval;
  networkMode?: NetworkMode; // default: NetworkMode.Online
  retry?: RetryConfig | number | false; // default: 3 on client, 0 on server
  refreshStaleOnReconnect?: boolean; // default: true
}

export interface StreamCacheOptions {
  maxCount?: number;
  gcTime?: number; // milliseconds - only applies to on-disk/persistent storage cleanup
}

export interface QueryPaginationOptions<Result> {
  getNextPageParams?(lastPage: Result, params?: QueryParams | undefined): QueryParams | undefined;
}

export type QueryParams = Record<
  string,
  | string
  | number
  | boolean
  | undefined
  | null
  | Signal<string | number | boolean | undefined | null>
  | unknown[] // For body array params
  | Record<string, unknown> // For body object params
>;

export const enum QueryType {
  Query = 'query',
  InfiniteQuery = 'infiniteQuery',
  Stream = 'stream',
}

export type StreamSubscribeFn<Params extends QueryParams | undefined, StreamType> = (
  context: QueryContext,
  params: Params,
  onUpdate: (update: StreamType) => void,
) => () => void;

export interface QueryDefinition<Params extends QueryParams | undefined, Result, StreamType> {
  type: QueryType.Query;
  id: string;
  shape: TypeDef;
  shapeKey: number;
  fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>;
  debounce?: number;
  cache?: QueryCacheOptions;
  stream?: {
    shape: TypeDef;
    shapeKey: number;
    subscribeFn: StreamSubscribeFn<Params, StreamType>;
  };
  optimisticInserts?: {
    shape: TypeDef;
    shapeKey: number;
  };
}

export interface InfiniteQueryDefinition<Params extends QueryParams | undefined, Result, StreamType> {
  type: QueryType.InfiniteQuery;
  id: string;
  shape: TypeDef;
  shapeKey: number;
  fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>;
  pagination: QueryPaginationOptions<Result>;
  debounce?: number;
  cache?: QueryCacheOptions;
  stream?: {
    shape: TypeDef;
    shapeKey: number;
    subscribeFn: StreamSubscribeFn<Params, StreamType>;
  };
  optimisticInserts?: {
    shape: TypeDef;
    shapeKey: number;
  };
}

export interface StreamQueryDefinition<Params extends QueryParams | undefined, StreamType> {
  type: QueryType.Stream;
  id: string;
  shape: EntityDef; // Must be entity
  shapeKey: number;
  subscribeFn: StreamSubscribeFn<Params, StreamType>;
  cache?: StreamCacheOptions;
}

export type AnyQueryDefinition<Params extends QueryParams | undefined, Result, Event> =
  | QueryDefinition<Params, Result, Event>
  | InfiniteQueryDefinition<Params, Result, Event>
  | StreamQueryDefinition<Params, Event>;

// -----------------------------------------------------------------------------
// QueryStore Interface
// -----------------------------------------------------------------------------

export interface CachedQuery {
  value: unknown;
  refIds: Set<number> | undefined;
  updatedAt: number;
  extra?: CachedQueryExtra;
}

export interface CachedQueryExtra {
  streamOrphanRefs?: number[];
  optimisticInsertRefs?: number[];
}

export interface QueryStore {
  /**
   * Asynchronously retrieves a document by key.
   * May return undefined if the document is not in the store.
   */
  loadQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): MaybePromise<CachedQuery | undefined>;

  /**
   * Synchronously stores a document with optional reference IDs.
   * This is fire-and-forget for async implementations.
   */
  saveQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: Set<number>,
    extra?: CachedQueryExtra,
  ): void;

  /**
   * Synchronously stores an entity with optional reference IDs.
   * This is fire-and-forget for async implementations.
   */
  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void;

  /**
   * Marks a query as accessed, updating the LRU queue.
   * Handles eviction internally when the cache is full.
   */
  activateQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): void;

  deleteQuery(queryKey: number): void;
}

export type MaybePromise<T> = T | Promise<T>;

/**
 * Checks if a value is a Signal instance.
 * Signals are objects with a `value` property and internal `_id` property.
 * Arrays and plain objects are NOT Signals.
 */
function isSignal(value: unknown): value is Signal<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    '_id' in value
  );
}

/**
 * Extracts actual values from params that may contain Signals.
 * Supports primitive values, arrays, and objects (for body params).
 */
export function extractParamsForKey(
  params: QueryParams | undefined,
): Record<string, unknown> | undefined {
  if (params === undefined) {
    return undefined;
  }

  const extracted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (isSignal(value)) {
      extracted[key] = value.value;
    } else {
      extracted[key] = value;
    }
  }

  return extracted;
}

/**
 * Computes the query key for instance lookup. This is used for two different keys:
 *
 * - Query instance key
 * - Query storage key
 *
 * Instance keys are created by passing in the query definition and parameters WITHOUT
 * extracting the Signal values, whereas storage keys are created by extracting the Signal values.
 * This way, we can reuse the same instance for given Signals, but different underlying values
 * will be stored and put into the LRU cache separately.
 */
export const queryKeyFor = (queryDef: AnyQueryDefinition<any, any, any>, params: unknown): number => {
  return hashValue([queryDef.id, queryDef.shapeKey, params]);
};

export class QueryClient {
  private entityMap: EntityStore;
  queryInstances = new Map<number, QueryResultImpl<unknown>>();
  mutationInstances = new Map<string, MutationResultImpl<unknown, unknown>>();
  memoryEvictionManager: MemoryEvictionManager;
  refetchManager: RefetchManager;
  networkManager: NetworkManager;
  isServer: boolean;

  constructor(
    private store: QueryStore,
    private context: QueryContext = { fetch, log: console },
    networkManager?: NetworkManager,
    memoryEvictionManager?: MemoryEvictionManager,
    refetchManager?: RefetchManager,
  ) {
    this.memoryEvictionManager =
      memoryEvictionManager ?? new MemoryEvictionManager(this, this.context.evictionMultiplier);
    this.refetchManager = refetchManager ?? new RefetchManager(this.context.refetchMultiplier);
    this.networkManager = networkManager ?? new NetworkManager();
    this.isServer = typeof window === 'undefined';
    this.entityMap = new EntityStore(this);
  }

  getContext(): QueryContext {
    return this.context;
  }

  saveQueryData(
    queryDef: AnyQueryDefinition<QueryParams | undefined, unknown, unknown>,
    queryKey: number,
    data: unknown,
    updatedAt: number,
    entityRefs?: Set<number>,
    extra?: CachedQueryExtra,
  ): void {
    // Clone entityRefs to avoid mutation in setValue
    const clonedRefs = entityRefs !== undefined ? new Set(entityRefs) : undefined;
    // QueryStore expects the base definition structure
    this.store.saveQuery(queryDef as any, queryKey, data, updatedAt, clonedRefs, extra);
  }

  activateQuery(queryInstance: QueryResultImpl<unknown>): void {
    const { def, queryKey, storageKey } = queryInstance;
    // Use storageKey for cache operations (store.activateQuery)
    this.store.activateQuery(def as any, storageKey);

    // Only add to refetch manager if it's not a stream
    if (def.type !== QueryType.Stream && def.cache?.refetchInterval) {
      this.refetchManager.addQuery(queryInstance);
    }
    // Use queryKey for instance eviction (memoryEvictionManager)
    this.memoryEvictionManager.cancelEviction(queryKey);
  }

  loadCachedQuery(queryDef: AnyQueryDefinition<QueryParams | undefined, unknown, unknown>, queryKey: number) {
    return this.store.loadQuery(queryDef as any, queryKey, this.entityMap);
  }

  deleteCachedQuery(queryKey: number): void {
    this.store.deleteQuery(queryKey);
  }

  /**
   * Loads a query from the document store and returns a QueryResult
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<T>(
    queryDef: AnyQueryDefinition<any, any, any>,
    params: QueryParams | undefined,
  ): QueryResult<T, unknown, unknown> {
    const queryKey = queryKeyFor(queryDef, params);

    let queryInstance = this.queryInstances.get(queryKey) as QueryResultImpl<T> | undefined;

    // Create a new instance if it doesn't exist
    if (queryInstance === undefined) {
      queryInstance = new QueryResultImpl(queryDef, this, queryKey, params);

      // Store for future use
      this.queryInstances.set(queryKey, queryInstance as QueryResultImpl<unknown>);
    }

    return queryInstance as unknown as QueryResult<T, unknown, unknown>;
  }

  /**
   * Gets or creates a MutationResult for the given mutation definition.
   * Mutations are cached by their definition ID.
   */
  getMutation<Request, Response>(
    mutationDef: MutationDefinition<Request, Response>,
  ): MutationResult<Request, Response> {
    const mutationId = mutationDef.id;

    let mutationInstance = this.mutationInstances.get(mutationId) as MutationResultImpl<Request, Response> | undefined;

    // Create a new instance if it doesn't exist
    if (mutationInstance === undefined) {
      mutationInstance = new MutationResultImpl(mutationDef, this);

      // Store for future use
      this.mutationInstances.set(mutationId, mutationInstance as MutationResultImpl<unknown, unknown>);
    }

    return mutationInstance as MutationResult<Request, Response>;
  }

  // ======================================================
  // Optimistic Update Management
  // ======================================================

  /**
   * Register pending optimistic updates for an entity.
   * Called by MutationResult when applying optimistic updates.
   */
  registerOptimisticUpdate(entityKey: number, fields: Record<string, unknown>): void {
    this.entityMap.registerOptimisticUpdate(entityKey, fields);
  }

  /**
   * Clear pending optimistic updates for an entity without reverting.
   * Called by MutationResult when mutation succeeds.
   */
  clearOptimisticUpdates(entityKey: number): void {
    this.entityMap.clearOptimisticUpdates(entityKey);
  }

  /**
   * Revert pending optimistic updates for an entity, restoring its snapshot.
   * Called by MutationResult when mutation fails.
   */
  revertOptimisticUpdate(entityKey: number): void {
    this.entityMap.revertOptimisticUpdate(entityKey);
  }

  hydrateEntity(key: number, shape: EntityDef): EntityRecord {
    return this.entityMap.hydratePreloadedEntity(key, shape);
  }

  saveEntity(key: number, obj: Record<string, unknown>, shape: EntityDef, entityRefs?: Set<number>): EntityRecord {
    // console.log('saveEntity', key, JSON.stringify(obj, null, 2), shape, entityRefs, new Error().stack);

    const record = this.entityMap.setEntity(key, obj, shape, entityRefs);

    // console.log('saveEntity record', JSON.stringify(obj, null, 2), new Error().stack);

    this.store.saveEntity(key, obj, entityRefs);

    return record;
  }

  getNestedEntityRefIds(key: number, refIds: Set<number>): Set<number> {
    return this.entityMap.getNestedEntityRefIds(key, refIds);
  }

  destroy(): void {
    this.refetchManager.destroy();
    this.memoryEvictionManager.destroy();
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);

/**
 * Add an optimistic insert to a query result.
 * The insert will be automatically removed when:
 * - The entity appears in a refetched response
 * - The entity appears as a stream orphan
 * - refetch() is called
 */
export function addOptimisticInsert<T extends Record<string, unknown>>(
  query: QueryResult<unknown, unknown, unknown>,
  insert: T,
): void {
  (query as unknown as QueryResultImpl<unknown>).addOptimisticInsert(insert);
}

/**
 * Remove an optimistic insert from a query result.
 * This is a no-op if the insert has already been removed.
 */
export function removeOptimisticInsert<T extends Record<string, unknown>>(
  query: QueryResult<unknown, unknown, unknown>,
  insert: T,
): void {
  (query as unknown as QueryResultImpl<unknown>).removeOptimisticInsert(insert);
}
