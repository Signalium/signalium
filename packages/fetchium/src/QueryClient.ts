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

import { context, ReactiveTask, type Context } from 'signalium';
import { hashValue } from 'signalium/utils';
import {
  EntityDef,
  RefetchInterval,
  NetworkMode,
  RetryConfig,
  BaseUrlValue,
  QueryRequestInit,
  MutationResultValue,
  QueryPromise,
  ComplexTypeDef,
  Mask,
  TypeDef,
  InternalTypeDef,
} from './types.js';
import { EntityStore } from './EntityMap.js';
import { EntityInstance } from './EntityInstance.js';
import { NetworkManager } from './NetworkManager.js';
import { QueryInstance } from './QueryResult.js';
import { MutationResultImpl } from './MutationResult.js';
import { MutationDefinition } from './mutation.js';
import { RefetchManager, NoOpRefetchManager } from './RefetchManager.js';
import { GcManager, NoOpGcManager, GcKeyType } from './GcManager.js';
import { DEFAULT_GC_TIME } from './stores/shared.js';
import { type Signal } from 'signalium';
import { Query, QueryDefinition } from './query.js';
import { parseEntities } from './parseEntities.js';
import { parseValue } from './proxy.js';
import { ValidatorDef } from './typeDefs.js';

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
  cacheTime?: number; // minutes - on-disk/persistent storage expiration. Default: 1440 (24 hours)
  gcTime?: number; // minutes - in-memory eviction time. Default: 5. Use 0 for next-tick, Infinity to never GC.
  staleTime?: number; // milliseconds - how long data is considered fresh. Default: 0 (always stale)
  refetchInterval?: RefetchInterval;
  networkMode?: NetworkMode; // default: NetworkMode.Online
  retry?: RetryConfig | number | false; // default: 3 on client, 0 on server
  refreshStaleOnReconnect?: boolean; // default: true
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

// -----------------------------------------------------------------------------
// QueryStore Interface
// -----------------------------------------------------------------------------

export type PreloadedEntityMap = Map<number, Record<string, unknown>>;

export interface CachedQuery {
  value: unknown;
  refIds: Set<number> | undefined;
  updatedAt: number;
  preloadedEntities?: PreloadedEntityMap;
}

export interface QueryStore {
  /**
   * Asynchronously retrieves a document by key.
   * Returns a CachedQuery with preloaded entity data if entities are referenced.
   */
  loadQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): MaybePromise<CachedQuery | undefined>;

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

  /**
   * Scans all persisted query types and purges those whose data has expired
   * based on their cacheTime. Called on startup to clean up stale entries
   * from previous sessions (e.g., after shapeKey changes or removed queries).
   */
  purgeStaleQueries?(): MaybePromise<void>;
}

export type MaybePromise<T> = T | Promise<T>;

/**
 * Checks if a value is a Signal instance.
 * Signals are objects with a `value` property and internal `_id` property.
 * Arrays and plain objects are NOT Signals.
 */
function isSignal(value: unknown): value is Signal<any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'value' in value && '_id' in value;
}

/**
 * Extracts actual values from params that may contain Signals.
 * Supports primitive values, arrays, and objects (for body params).
 */
export function extractParamsForKey(params: QueryParams | undefined): Record<string, unknown> | undefined {
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
export const queryKeyFor = (queryDef: QueryDefinition<any, any, any>, params: unknown): number => {
  return hashValue([queryDef.id, queryDef.shapeKey, params]);
};

export class QueryClient {
  private entityMap: EntityStore;
  queryInstances = new Map<number, QueryInstance<any>>();
  mutationInstances = new Map<string, MutationResultImpl<unknown, unknown>>();
  gcManager: GcManager | NoOpGcManager;
  refetchManager: RefetchManager | NoOpRefetchManager;
  networkManager: NetworkManager;
  isServer: boolean;

  currentParseId: number = 0;

  constructor(
    private store: QueryStore,
    private context: QueryContext = { fetch, log: console },
    networkManager?: NetworkManager,
    gcManager?: GcManager | NoOpGcManager,
    refetchManager?: RefetchManager | NoOpRefetchManager,
  ) {
    this.isServer = typeof window === 'undefined';
    this.entityMap = new EntityStore(this);
    this.gcManager =
      gcManager ??
      (this.isServer ? new NoOpGcManager() : new GcManager(this.handleEviction, this.context.evictionMultiplier));
    this.refetchManager =
      refetchManager ?? (this.isServer ? new NoOpRefetchManager() : new RefetchManager(this.context.refetchMultiplier));
    this.networkManager = networkManager ?? new NetworkManager();

    this.store.purgeStaleQueries?.();
  }

  getContext(): QueryContext {
    return this.context;
  }

  saveQueryData(
    queryDef: QueryDefinition<QueryParams | undefined, unknown, unknown>,
    queryKey: number,
    data: unknown,
    updatedAt: number,
    entityRefs?: Set<number>,
  ): void {
    // Clone entityRefs to avoid mutation in setValue
    const clonedRefs = entityRefs !== undefined ? new Set(entityRefs) : undefined;
    // QueryStore expects the base definition structure
    this.store.saveQuery(queryDef as any, queryKey, data, updatedAt, clonedRefs);
  }

  activateQuery(queryInstance: QueryInstance<any>): void {
    const { def, queryKey, storageKey } = queryInstance;
    this.store.activateQuery(def as any, storageKey);

    if (def.cache?.refetchInterval) {
      this.refetchManager.addQuery(queryInstance);
    }

    const gcTime = def.cache?.gcTime ?? DEFAULT_GC_TIME;
    this.gcManager.cancel(queryKey, gcTime);
  }

  loadCachedQuery(queryDef: QueryDefinition<QueryParams | undefined, unknown, unknown>, queryKey: number) {
    return this.store.loadQuery(queryDef as any, queryKey);
  }

  deleteCachedQuery(queryKey: number): void {
    this.store.deleteQuery(queryKey);
  }

  /**
   * Loads a query from the document store and returns a QueryResult
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<T extends Query>(
    queryDef: QueryDefinition<any, any, any>,
    params: QueryParams | undefined,
  ): QueryPromise<T> {
    const queryKey = queryKeyFor(queryDef, params);

    let queryInstance = this.queryInstances.get(queryKey) as QueryInstance<T> | undefined;

    // Create a new instance if it doesn't exist
    if (queryInstance === undefined) {
      queryInstance = new QueryInstance(queryDef, this, queryKey, params);

      // Store for future use
      this.queryInstances.set(queryKey, queryInstance as QueryInstance<any>);
    }

    return queryInstance.relay;
  }

  /**
   * Gets or creates a MutationResult for the given mutation definition.
   * Mutations are cached by their definition ID.
   */
  getMutation<Request, Response>(
    mutationDef: MutationDefinition<Request, Response>,
  ): ReactiveTask<MutationResultValue<Response>, [Request]> {
    const mutationId = mutationDef.id;

    let mutationInstance = this.mutationInstances.get(mutationId) as MutationResultImpl<Request, Response> | undefined;

    // Create a new instance if it doesn't exist
    if (mutationInstance === undefined) {
      mutationInstance = new MutationResultImpl(mutationDef, this);

      // Store for future use
      this.mutationInstances.set(mutationId, mutationInstance as MutationResultImpl<unknown, unknown>);
    }

    return mutationInstance.task;
  }

  // TODO: Optimistic update methods will be re-added later
  registerOptimisticUpdate(_entityKey: number, _fields: Record<string, unknown>): void {}
  clearOptimisticUpdates(_entityKey: number): void {}
  revertOptimisticUpdate(_entityKey: number): void {}

  getEntity(key: number): EntityInstance | undefined {
    return this.entityMap.getEntity(key);
  }

  parseEntities(
    obj: unknown,
    shape: InternalTypeDef,
    entityRefs?: Set<number>,
    preloadedEntities?: PreloadedEntityMap,
  ): unknown {
    this.currentParseId++;
    const result = parseEntities(obj, shape as unknown as ComplexTypeDef, this, entityRefs, preloadedEntities);
    return parseValue(result, shape as unknown as TypeDef, '', false);
  }

  saveEntity(
    key: number,
    obj: Record<string, unknown>,
    shape: EntityDef,
    entityRefs?: Set<number>,
    persist?: boolean,
  ): EntityInstance {
    const instance = this.entityMap.getOrCreateEntity(key, obj, shape);

    // Diff old vs new child entity refs
    const oldRefs = instance.entityRefs;
    if (entityRefs !== undefined && entityRefs.size > 0) {
      for (const childKey of entityRefs) {
        if (oldRefs === undefined || !oldRefs.has(childKey)) {
          this.entityMap.incrementRefCount(childKey);
        }
      }
    }
    if (oldRefs !== undefined && oldRefs.size > 0) {
      for (const childKey of oldRefs) {
        if (entityRefs === undefined || !entityRefs.has(childKey)) {
          this.decrementEntityRef(childKey);
        }
      }
    }
    instance.entityRefs = entityRefs;

    if (persist) {
      this.store.saveEntity(key, obj, entityRefs);
    }

    return instance;
  }

  // ======================================================
  // In-Memory GC
  // ======================================================

  scheduleQueryEviction(queryInstance: QueryInstance<any>): void {
    const gcTime = queryInstance.def.cache?.gcTime ?? DEFAULT_GC_TIME;
    this.gcManager.schedule(queryInstance.queryKey, gcTime, GcKeyType.Query);
  }

  /**
   * Diff old vs new entity refs and update in-memory ref counts accordingly.
   */
  updateEntityRefs(oldRefs: Set<number> | undefined, newRefs: Set<number>): void {
    if (oldRefs !== undefined) {
      for (const key of oldRefs) {
        if (!newRefs.has(key)) {
          this.decrementEntityRef(key);
        }
      }
    }
    for (const key of newRefs) {
      if (oldRefs === undefined || !oldRefs.has(key)) {
        this.entityMap.incrementRefCount(key);

        const entityGcTime = this.getEntityShapeDef(key)?._entityCache?.gcTime;
        if (entityGcTime !== undefined) {
          this.gcManager.cancel(key, entityGcTime);
        }
      }
    }
  }

  private decrementEntityRef(entityKey: number): void {
    const reachedZero = this.entityMap.decrementRefCount(entityKey);
    if (!reachedZero) return;

    const shapeDef = this.getEntityShapeDef(entityKey);
    const entityGcTime = shapeDef?._entityCache?.gcTime;

    if (entityGcTime !== undefined) {
      this.gcManager.schedule(entityKey, entityGcTime, GcKeyType.Entity);
    } else {
      this.evictEntity(entityKey);
    }
  }

  private evictEntity(entityKey: number): void {
    const childRefs = this.entityMap.removeEntity(entityKey);
    if (childRefs !== undefined) {
      for (const childKey of childRefs) {
        this.decrementEntityRef(childKey);
      }
    }
  }

  private getEntityShapeDef(entityKey: number): ValidatorDef<unknown> | undefined {
    return this.entityMap.getEntity(entityKey)?.shapeDef;
  }

  private handleEviction = (key: number, type: GcKeyType): void => {
    if (type === GcKeyType.Query) {
      const instance = this.queryInstances.get(key);
      if (instance === undefined) return;

      this.queryInstances.delete(key);

      if (instance.entityRefs !== undefined) {
        for (const entityKey of instance.entityRefs) {
          this.decrementEntityRef(entityKey);
        }
      }
      return;
    }

    this.evictEntity(key);
  };

  destroy(): void {
    this.refetchManager.destroy();
    this.gcManager.destroy();
    this.networkManager.destroy();
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);
