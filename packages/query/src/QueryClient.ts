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

import { relay, type RelayState, context, DiscriminatedReactivePromise, type Context, Signal, signal } from 'signalium';
import { hashValue, setReactivePromise } from 'signalium/utils';
import {
  QueryResult,
  EntityDef,
  BaseQueryResult,
  ObjectFieldTypeDef,
  ComplexTypeDef,
  RefetchInterval,
} from './types.js';
import { parseValue } from './proxy.js';
import { parseEntities } from './parseEntities.js';
import { EntityRecord, EntityStore } from './EntityMap.js';
import { QueryStore } from './QueryStore.js';
import { ValidatorDef } from './typeDefs.js';

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
}

export interface QueryPaginationOptions<Result> {
  getNextPageParams?(lastPage: Result, params?: QueryParams | undefined): QueryParams | undefined;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface QueryDefinition<Params extends QueryParams | undefined, Result> {
  id: string;
  shape: ObjectFieldTypeDef;
  fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>;

  pagination?: QueryPaginationOptions<Result>;
  cache?: QueryCacheOptions;
}

const queryKeyFor = (queryDef: QueryDefinition<any, any>, params: unknown): number => {
  return hashValue([queryDef.id, params]);
};

const BASE_TICK_INTERVAL = 1000; // 1 second

// Refetch interval manager - uses a fixed 1-second tick
class RefetchManager {
  private intervalId: NodeJS.Timeout;
  private clock: number = 0; // Increments by 1000ms on each tick

  // Buckets: Map of actual interval -> Set of query instances
  private buckets = new Map<number, Set<QueryResultImpl<any>>>();

  constructor(private multiplier: number = 1) {
    // Start the timer immediately and keep it running
    const tickInterval = BASE_TICK_INTERVAL * this.multiplier;
    this.intervalId = setTimeout(() => this.tick(), tickInterval);
  }

  addQuery(instance: QueryResultImpl<any>) {
    const interval = instance.def.cache?.refetchInterval;

    if (!interval) {
      return;
    }

    const actualInterval = interval * this.multiplier;
    // Add to bucket by actual interval
    let bucket = this.buckets.get(actualInterval);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(actualInterval, bucket);
    }
    bucket.add(instance);
  }

  removeQuery(query: QueryResultImpl<any>) {
    const interval = query.def.cache?.refetchInterval;

    if (!interval) {
      return;
    }

    const actualInterval = interval * this.multiplier;
    // Remove from bucket
    const bucket = this.buckets.get(actualInterval);
    if (bucket) {
      bucket.delete(query);

      if (bucket.size === 0) {
        this.buckets.delete(actualInterval);
      }
    }
  }

  private tick() {
    this.clock += BASE_TICK_INTERVAL * this.multiplier;

    // Only process buckets where clock is aligned with the interval
    for (const [interval, bucket] of this.buckets.entries()) {
      if (this.clock % interval === 0) {
        // Process all queries in this bucket
        for (const query of bucket) {
          // Skip if already fetching - let the current fetch complete
          if (query && !query.isFetching) {
            query.refetch();
          }
        }
      }
    }

    const tickInterval = BASE_TICK_INTERVAL * this.multiplier;
    this.intervalId = setTimeout(() => this.tick(), tickInterval);
  }

  destroy(): void {
    clearTimeout(this.intervalId);
  }
}

const EVICTION_INTERVAL = 60 * 1000; // 1 minute

// Memory eviction manager - uses a single interval with rotating sets to avoid timeout overhead
class MemoryEvictionManager {
  private intervalId: NodeJS.Timeout;
  private currentFlush = new Set<number>(); // Queries to evict on next tick
  private nextFlush = new Set<number>(); // Queries to evict on tick after next

  constructor(
    private queryClient: QueryClient,
    private multiplier: number = 1,
  ) {
    this.intervalId = setInterval(this.tick, EVICTION_INTERVAL * this.multiplier);
  }

  scheduleEviction(queryKey: number) {
    // Add to nextFlush so it waits at least one full interval
    // This prevents immediate eviction if scheduled right before a tick
    this.nextFlush.add(queryKey);
  }

  cancelEviction(queryKey: number) {
    // Remove from both sets to handle reactivation
    this.currentFlush.delete(queryKey);
    this.nextFlush.delete(queryKey);
  }

  private tick = () => {
    if (!this.queryClient) return;

    // Evict all queries in currentFlush
    for (const queryKey of this.currentFlush) {
      this.queryClient.queryInstances.delete(queryKey);
    }

    // Rotate: currentFlush becomes nextFlush, nextFlush becomes empty
    this.currentFlush = this.nextFlush;
    this.nextFlush = new Set();
  };

  destroy(): void {
    clearInterval(this.intervalId);
  }
}

/**
 * QueryResult wraps a DiscriminatedReactivePromise and adds additional functionality
 * like refetch, while forwarding all the base relay properties.
 * This class combines the old QueryInstance and QueryResultImpl into a single entity.
 */
export class QueryResultImpl<T> implements BaseQueryResult<T> {
  def: QueryDefinition<any, any>;
  queryKey: number;

  private queryClient: QueryClient;
  private initialized: boolean = false;
  private isRefetchingSignal: Signal<boolean> = signal(false);
  private isFetchingMoreSignal: Signal<boolean> = signal(false);
  private updatedAt: number | undefined = undefined;
  private params: QueryParams | undefined = undefined;
  private refIds: Set<number> | undefined = undefined;

  private refetchPromise: Promise<T> | undefined = undefined;
  private fetchMorePromise: Promise<T> | undefined = undefined;

  private relay: DiscriminatedReactivePromise<T>;
  private _relayState: RelayState<any> | undefined = undefined;

  private get relayState(): RelayState<any> {
    const relayState = this._relayState;

    if (!relayState) {
      throw new Error('Relay state not initialized');
    }

    return relayState;
  }

  private _nextPageParams: QueryParams | undefined | null = undefined;

  private get nextPageParams(): QueryParams | null {
    let params = this._nextPageParams;

    const value = this.relayState.value;

    if (params === undefined && value !== undefined) {
      if (!Array.isArray(value)) {
        throw new Error('Query result is not an array, this is a bug');
      }

      const nextParams = this.def.pagination?.getNextPageParams?.(value[value.length - 1]);

      if (nextParams === undefined) {
        // store null to indicate that there is no next page, but we've already calculated
        params = null;
      } else {
        // Clone current params
        let hasDefinedParams = false;
        const clonedParams = { ...this.params };

        // iterate over the next page params and copy any defined values to the
        for (const [key, value] of Object.entries(nextParams)) {
          if (value !== undefined && value !== null) {
            clonedParams[key] = value;
            hasDefinedParams = true;
          }
        }

        this._nextPageParams = params = hasDefinedParams ? clonedParams : null;
      }
    }

    return params ?? null;
  }

  constructor(
    def: QueryDefinition<any, any>,
    queryClient: QueryClient,
    queryKey: number,
    params: QueryParams | undefined,
  ) {
    setReactivePromise(this);
    this.def = def;
    this.queryClient = queryClient;
    this.queryKey = queryKey;
    this.params = params;

    // Create the relay and handle activation/deactivation
    this.relay = relay<T>(state => {
      this._relayState = state;
      // Load from cache first, then fetch fresh data
      this.queryClient.activateQuery(this);

      if (this.initialized) {
        if (this.isStale) {
          this.refetch();
        }
      } else {
        this.initialize();
      }

      // Return deactivation callback
      return {
        update: () => {
          state.setPromise(this.runQuery(this.params, true));
        },
        deactivate: () => {
          // Last subscriber left, deactivate refetch and schedule memory eviction
          if (this.def.cache?.refetchInterval) {
            this.queryClient.refetchManager.removeQuery(this);
          }

          // Schedule removal from memory using the global eviction manager
          // This allows quick reactivation from memory if needed again soon
          // Disk cache (if configured) will still be available after eviction
          this.queryClient.memoryEvictionManager.scheduleEviction(this.queryKey);
        },
      };
    }) as DiscriminatedReactivePromise<T>;
  }

  // ======================================================
  // ReactivePromise properties
  // =====================================================

  get value(): T | undefined {
    return this.relay.value;
  }

  get error(): unknown {
    return this.relay.error;
  }

  get isPending(): boolean {
    return this.relay.isPending;
  }

  get isRejected(): boolean {
    return this.relay.isRejected;
  }

  get isResolved(): boolean {
    return this.relay.isResolved;
  }

  get isSettled(): boolean {
    return this.relay.isSettled;
  }

  get isReady(): boolean {
    return this.relay.isReady;
  }

  // TODO: Intimate APIs needed for `useReactive`, this is a code smell and
  // we should find a better way to entangle these more generically
  private get _version(): Signal<number> {
    return (this.relay as any)._version;
  }

  private get _signal(): Signal<T> {
    return (this.relay as any)._signal;
  }

  private get _flags(): number {
    return (this.relay as any)._flags;
  }

  // Forward Promise methods
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2> {
    return this.relay.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined,
  ): Promise<T | TResult> {
    return this.relay.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<T> {
    return this.relay.finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'QueryResult';
  }

  // ======================================================
  // Internal fetch methods
  // ======================================================

  /**
   * Initialize the query by loading from cache and fetching if stale
   */
  private async initialize(): Promise<void> {
    const state = this.relayState;

    try {
      this.initialized = true;
      // Load from cache first
      const cached = await this.queryClient.loadCachedQuery(this.def, this.queryKey);

      if (cached !== undefined) {
        const shape = this.def.shape;
        state.value =
          shape instanceof ValidatorDef
            ? parseEntities(cached.value, shape as ComplexTypeDef, this.queryClient, new Set())
            : parseValue(cached.value, shape, this.def.id);

        // Set the cached timestamp
        this.updatedAt = cached.updatedAt;

        // Set the cached reference IDs
        this.refIds = cached.refIds;

        // Check if data is stale
        if (this.isStale) {
          // Data is stale, trigger background refetch
          this.refetch();
        }
      } else {
        // No cached data, fetch fresh
        state.setPromise(this.runQuery(this.params, true));
      }
    } catch (error) {
      // Relay will handle the error state automatically
      state.setError(error as Error);
    }
  }

  /**
   * Fetches fresh data, updates the cache, and updates updatedAt timestamp
   */
  private async runQuery(params: QueryParams | undefined, reset = false): Promise<T> {
    const freshData = await this.def.fetchFn(this.queryClient.getContext(), params);

    // Parse and cache the fresh data
    let entityRefs;

    if (this.def.pagination && !reset && this.refIds !== undefined) {
      entityRefs = this.refIds;
    } else {
      entityRefs = new Set<number>();
    }

    const shape = this.def.shape;

    const parsedData =
      shape instanceof ValidatorDef
        ? parseEntities(freshData, shape as ComplexTypeDef, this.queryClient, entityRefs)
        : parseValue(freshData, shape, this.def.id);

    let queryData;

    if (this.def.pagination) {
      const prevQueryData = this.relayState.value;
      queryData = reset || prevQueryData === undefined ? [parsedData] : [...prevQueryData, parsedData];
    } else {
      queryData = parsedData;
    }

    let updatedAt;

    if (reset) {
      updatedAt = this.updatedAt = Date.now();
    } else {
      updatedAt = this.updatedAt ??= Date.now();
    }

    this._nextPageParams = undefined;

    // Cache the data (synchronous, fire-and-forget)
    this.queryClient.saveQueryData(this.def, this.queryKey, queryData, updatedAt, entityRefs);

    // Update the timestamp
    this.updatedAt = Date.now();

    return queryData as T;
  }

  // ======================================================
  // Public methods
  // ======================================================

  refetch(): Promise<T> {
    if (this.fetchMorePromise) {
      throw new Error('Query is fetching more, cannot refetch');
    }

    if (this.refetchPromise) {
      return this.refetchPromise;
    }

    // Clear memoized nextPageParams so it's recalculated after refetch
    this._nextPageParams = undefined;

    // Set the signal before any async operations so it's immediately visible
    // Use untrack to avoid reactive violations when called from reactive context
    this.isRefetchingSignal.value = true;
    this._version.update(v => v + 1);

    const promise = this.runQuery(this.params, true)
      .then(result => {
        this.relayState.value = result;
        return result;
      })
      .catch((error: unknown) => {
        this.relayState.setError(error);
        return Promise.reject(error);
      })
      .finally(() => {
        this._version.update(v => v + 1);
        this.isRefetchingSignal.value = false;
        this.refetchPromise = undefined;
      });

    this.refetchPromise = promise;
    return promise;
  }

  fetchNextPage(): Promise<T> {
    if (this.refetchPromise) {
      return Promise.reject(new Error('Query is refetching, cannot fetch next page'));
    }

    if (this.fetchMorePromise) {
      return this.fetchMorePromise;
    }

    // Read nextPageParams in untracked context to avoid reactive violations
    const nextPageParams = this.nextPageParams;

    if (!nextPageParams) {
      return Promise.reject(new Error('No next page params'));
    }

    // Set the signal before any async operations so it's immediately visible
    // Use untrack to avoid reactive violations when called from reactive context
    this.isFetchingMoreSignal.value = true;
    this._version.update(v => v + 1);

    const promise = this.runQuery(nextPageParams, false)
      .then(result => {
        this.relayState!.value = result;
        return result as T;
      })
      .catch((error: unknown) => {
        this.relayState.setError(error);
        return Promise.reject(error);
      })
      .finally(() => {
        this._version.update(v => v + 1);
        this.isFetchingMoreSignal.value = false;
        this.fetchMorePromise = undefined;
      });

    this.fetchMorePromise = promise;
    return promise;
  }

  // ======================================================
  // Public properties
  // ======================================================

  get isRefetching(): boolean {
    return this.isRefetchingSignal.value;
  }

  get isFetchingMore(): boolean {
    return this.isFetchingMoreSignal.value;
  }

  get isFetching(): boolean {
    return this.relay.isPending || this.isRefetching || this.isFetchingMore;
  }

  get hasNextPage(): boolean {
    return this.nextPageParams !== null;
  }

  get isStale(): boolean {
    if (this.updatedAt === undefined) {
      return true; // No data yet, needs fetch
    }

    const staleTime = this.def.cache?.staleTime ?? 0;
    return Date.now() - this.updatedAt >= staleTime;
  }
}

export class QueryClient {
  private entityMap = new EntityStore();
  queryInstances = new Map<number, QueryResultImpl<unknown>>();
  memoryEvictionManager: MemoryEvictionManager;
  refetchManager: RefetchManager;

  constructor(
    private store: QueryStore,
    private context: QueryContext = { fetch },
  ) {
    this.memoryEvictionManager = new MemoryEvictionManager(this, this.context.evictionMultiplier);
    this.refetchManager = new RefetchManager(this.context.refetchMultiplier);
  }

  getContext(): QueryContext {
    return this.context;
  }

  saveQueryData(
    queryDef: QueryDefinition<QueryParams | undefined, unknown>,
    queryKey: number,
    data: unknown,
    updatedAt: number,
    entityRefs: Set<number>,
  ): void {
    this.store.saveQuery(queryDef, queryKey, data, updatedAt, entityRefs);
  }

  activateQuery(queryInstance: QueryResultImpl<unknown>): void {
    const { def, queryKey } = queryInstance;
    this.store.activateQuery(def, queryKey);

    this.refetchManager.addQuery(queryInstance);
    this.memoryEvictionManager.cancelEviction(queryKey);
  }

  loadCachedQuery(queryDef: QueryDefinition<QueryParams | undefined, unknown>, queryKey: number) {
    return this.store.loadQuery(queryDef, queryKey, this.entityMap);
  }

  /**
   * Loads a query from the document store and returns a QueryResult
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<T>(queryDef: QueryDefinition<any, any>, params: QueryParams | undefined): QueryResult<T> {
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
