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
import { QueryResult, EntityDef, RefetchInterval, NetworkMode, RetryConfig, TypeDef } from './types.js';
import { EntityRecord, EntityStore } from './EntityMap.js';
import { NetworkManager } from './NetworkManager.js';
import { QueryResultImpl } from './QueryResult.js';
import { RefetchManager } from './RefetchManager.js';
import { MemoryEvictionManager } from './MemoryEvictionManager.js';

// -----------------------------------------------------------------------------
// Query Types
// -----------------------------------------------------------------------------

export interface QueryContext {
  fetch: typeof fetch;
  evictionMultiplier?: number;
  refetchMultiplier?: number;
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

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export const enum QueryType {
  Query = 'query',
  InfiniteQuery = 'infiniteQuery',
  Stream = 'stream',
}

export interface QueryDefinition<Params extends QueryParams | undefined, Result> {
  type: QueryType.Query;
  id: string;
  shape: TypeDef;
  shapeKey: number;
  fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>;
  cache?: QueryCacheOptions;
}

export interface InfiniteQueryDefinition<Params extends QueryParams | undefined, Result> {
  type: QueryType.InfiniteQuery;
  id: string;
  shape: TypeDef;
  shapeKey: number;
  fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>;
  pagination: QueryPaginationOptions<Result>;
  cache?: QueryCacheOptions;
}

export interface StreamQueryDefinition<Params extends QueryParams | undefined, Result> {
  type: QueryType.Stream;
  id: string;
  shape: EntityDef; // Must be entity
  shapeKey: number;
  subscribeFn: (context: QueryContext, params: Params, onUpdate: (update: Partial<Result>) => void) => () => void; // Returns unsubscribe function
  cache?: StreamCacheOptions;
}

export type AnyQueryDefinition<Params extends QueryParams | undefined, Result> =
  | QueryDefinition<Params, Result>
  | InfiniteQueryDefinition<Params, Result>
  | StreamQueryDefinition<Params, Result>;

// -----------------------------------------------------------------------------
// QueryStore Interface
// -----------------------------------------------------------------------------

export interface CachedQuery {
  value: unknown;
  refIds: Set<number> | undefined;
  updatedAt: number;
}

export interface QueryStore {
  /**
   * Asynchronously retrieves a document by key.
   * May return undefined if the document is not in the store.
   */
  loadQuery(
    queryDef: QueryDefinition<any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): MaybePromise<CachedQuery | undefined>;

  /**
   * Synchronously stores a document with optional reference IDs.
   * This is fire-and-forget for async implementations.
   */
  saveQuery(
    queryDef: QueryDefinition<any, any>,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: Set<number>,
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
  activateQuery(queryDef: QueryDefinition<any, any>, queryKey: number): void;
}

export type MaybePromise<T> = T | Promise<T>;

export const queryKeyFor = (queryDef: AnyQueryDefinition<any, any>, params: unknown): number => {
  return hashValue([queryDef.id, queryDef.shapeKey, params]);
};

export class QueryClient {
  private entityMap = new EntityStore();
  queryInstances = new Map<number, QueryResultImpl<unknown>>();
  memoryEvictionManager: MemoryEvictionManager;
  refetchManager: RefetchManager;
  networkManager: NetworkManager;
  isServer: boolean;

  constructor(
    private store: QueryStore,
    private context: QueryContext = { fetch },
    networkManager?: NetworkManager,
    memoryEvictionManager?: MemoryEvictionManager,
    refetchManager?: RefetchManager,
  ) {
    this.memoryEvictionManager = memoryEvictionManager ?? new MemoryEvictionManager(this, this.context.evictionMultiplier);
    this.refetchManager = refetchManager ?? new RefetchManager(this.context.refetchMultiplier);
    this.networkManager = networkManager ?? new NetworkManager();
    this.isServer = typeof window === 'undefined';
  }

  getContext(): QueryContext {
    return this.context;
  }

  saveQueryData(
    queryDef: AnyQueryDefinition<QueryParams | undefined, unknown>,
    queryKey: number,
    data: unknown,
    updatedAt: number,
    entityRefs: Set<number>,
  ): void {
    // QueryStore expects the base definition structure
    this.store.saveQuery(queryDef as any, queryKey, data, updatedAt, entityRefs);
  }

  activateQuery(queryInstance: QueryResultImpl<unknown>): void {
    const { def, queryKey } = queryInstance;
    this.store.activateQuery(def as any, queryKey);

    // Only add to refetch manager if it's not a stream
    if (def.type !== QueryType.Stream && def.cache?.refetchInterval) {
      this.refetchManager.addQuery(queryInstance);
    }
    this.memoryEvictionManager.cancelEviction(queryKey);
  }

  loadCachedQuery(queryDef: AnyQueryDefinition<QueryParams | undefined, unknown>, queryKey: number) {
    return this.store.loadQuery(queryDef as any, queryKey, this.entityMap);
  }

  /**
   * Loads a query from the document store and returns a QueryResult
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<T>(queryDef: AnyQueryDefinition<any, any>, params: QueryParams | undefined): QueryResult<T> {
    const queryKey = queryKeyFor(queryDef, params);

    let queryInstance = this.queryInstances.get(queryKey) as QueryResultImpl<T> | undefined;

    // Create a new instance if it doesn't exist
    if (queryInstance === undefined) {
      queryInstance = new QueryResultImpl(queryDef, this, queryKey, params);

      // Store for future use
      this.queryInstances.set(queryKey, queryInstance as QueryResultImpl<unknown>);
    }

    return queryInstance as QueryResult<T>;
  }

  hydrateEntity(key: number, shape: EntityDef): EntityRecord {
    return this.entityMap.hydratePreloadedEntity(key, shape);
  }

  saveEntity(key: number, obj: Record<string, unknown>, shape: EntityDef, entityRefs?: Set<number>): EntityRecord {
    const record = this.entityMap.setEntity(key, obj, shape);

    this.store.saveEntity(key, obj, entityRefs);

    return record;
  }

  destroy(): void {
    this.refetchManager.destroy();
    this.memoryEvictionManager.destroy();
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);
