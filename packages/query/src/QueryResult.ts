import {
  relay,
  type RelayState,
  DiscriminatedReactivePromise,
  Signal,
  signal,
  ReadonlySignal,
  reactiveSignal,
} from 'signalium';
import { setReactivePromise } from 'signalium/utils';
import { EntityDef, BaseQueryResult, ComplexTypeDef, NetworkMode } from './types.js';
import { getProxyId, parseValue } from './proxy.js';
import { parseEntities, parseObjectEntities } from './parseEntities.js';
import { ValidatorDef } from './typeDefs.js';
import {
  InfiniteQueryDefinition,
  QueryDefinition,
  QueryType,
  StreamSubscribeFn,
  type AnyQueryDefinition,
  type QueryClient,
  type QueryParams,
  extractParamsForKey,
  queryKeyFor,
} from './QueryClient.js';
import { CachedQuery } from './QueryClient.js';

// ======================================================
// QueryResultImpl
// ======================================================

/**
 * QueryResult wraps a DiscriminatedReactivePromise and adds additional functionality
 * like refetch, while forwarding all the base relay properties.
 * This class combines the old QueryInstance and QueryResultImpl into a single entity.
 */
export class QueryResultImpl<T> implements BaseQueryResult<T> {
  def: AnyQueryDefinition<any, any, any>;
  queryKey: number; // Instance key (includes Signal identity)
  storageKey: number = -1; // Storage key (extracted values only)

  private queryClient: QueryClient;
  private initialized: boolean = false;
  private isRefetchingSignal: Signal<boolean> = signal(false);
  private isFetchingMoreSignal: Signal<boolean> = signal(false);
  private updatedAt: number | undefined = undefined;
  private params: QueryParams | undefined = undefined;
  private refIds: Set<number> | undefined = undefined;

  private allNestedRefIdsSignal: ReadonlySignal<Set<number>> | undefined = undefined;

  private refetchPromise: Promise<T> | undefined = undefined;
  private fetchMorePromise: Promise<T> | undefined = undefined;
  private unsubscribe?: () => void = undefined;

  private relay: DiscriminatedReactivePromise<T>;
  private _relayState: RelayState<any> | undefined = undefined;
  private wasPaused: boolean = false;
  private currentParams: QueryParams | undefined = undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  private get relayState(): RelayState<any> {
    const relayState = this._relayState;

    if (!relayState) {
      throw new Error('Relay state not initialized');
    }

    return relayState;
  }

  private _nextPageParams: QueryParams | undefined | null = undefined;

  private get nextPageParams(): QueryParams | null {
    // Streams and non-infinite queries don't have pagination
    if (this.def.type !== QueryType.InfiniteQuery) {
      return null;
    }

    let params = this._nextPageParams;

    const value = this.relayState.value;

    if (params === undefined && value !== undefined) {
      if (!Array.isArray(value)) {
        throw new Error('Query result is not an array, this is a bug');
      }

      const infiniteDef = this.def as InfiniteQueryDefinition<any, any, any>;
      const nextParams = infiniteDef.pagination?.getNextPageParams?.(value[value.length - 1]);

      if (nextParams === undefined) {
        // store null to indicate that there is no next page, but we've already calculated
        params = null;
      } else {
        // Clone current params
        let hasDefinedParams = false;
        const clonedParams = { ...this.currentParams };

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
    def: AnyQueryDefinition<any, any, any>,
    queryClient: QueryClient,
    queryKey: number,
    params: QueryParams | undefined,
  ) {
    setReactivePromise(this);
    this.def = def;
    this.queryClient = queryClient;
    this.queryKey = queryKey; // Instance key (Signal identity)
    this.params = params;

    // Create the relay and handle activation/deactivation
    this.relay = relay<T>(state => {
      this._relayState = state;

      // Extract params (reading Signal values establishes tracking)
      this.currentParams = extractParamsForKey(this.params);
      this.storageKey = queryKeyFor(this.def, this.currentParams);

      // Load from cache first, then fetch fresh data
      this.queryClient.activateQuery(this);

      // Store initial offline state
      const isPaused = this.isPaused;
      this.wasPaused = isPaused;

      if (this.initialized) {
        if (!isPaused) {
          // For any query with streams, resubscribe on reactivation
          if (
            this.def.type === QueryType.Stream ||
            (this.def as QueryDefinition<any, any, any> | InfiniteQueryDefinition<any, any, any>).stream
          ) {
            this.setupSubscription();
          }

          if (this.def.type !== QueryType.Stream && this.isStale) {
            this.refetch();
          }
        }
      } else {
        this.initialize();
      }

      const deactivate = () => {
        // Clear debounce timer if active
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;

        // Last subscriber left, deactivate refetch and schedule memory eviction
        // Unsubscribe from any active streams
        this.unsubscribe?.();
        this.unsubscribe = undefined;

        // Remove from refetch manager if configured
        if (this.def.type !== QueryType.Stream && this.def.cache?.refetchInterval) {
          this.queryClient.refetchManager.removeQuery(this);
        }

        // Schedule removal from memory using the global eviction manager
        // This allows quick reactivation from memory if needed again soon
        // Disk cache (if configured) will still be available after eviction
        // Use queryKey for instance eviction, storageKey for cache eviction
        this.queryClient.memoryEvictionManager.scheduleEviction(this.queryKey);
      };

      // Return deactivation callback
      return {
        update: () => {
          const { wasPaused, isPaused } = this;
          this.wasPaused = isPaused;

          if (isPaused) {
            deactivate();

            // TODO: Add abort signal
            return;
          }

          // Read Signal values again to establish tracking for any new Signals
          // Extract params (reading Signal values establishes tracking)
          const newExtractedParams = extractParamsForKey(this.params);
          const newStorageKey = queryKeyFor(this.def, newExtractedParams);

          const paramsDidChange = newStorageKey !== this.storageKey;

          // Check if storage key changed (comparing hash values)
          if (paramsDidChange) {
            // Same storage key, just Signal instances changed but values are the same
            // Update params and trigger debounced refetch
            this.params = newExtractedParams as QueryParams;
            this.storageKey = newStorageKey;
          }

          if (wasPaused) {
            this.queryClient.activateQuery(this);

            if (this.def.type !== QueryType.Stream) {
              const refreshStaleOnReconnect = this.def.cache?.refreshStaleOnReconnect ?? true;
              if (refreshStaleOnReconnect && this.isStale) {
                state.setPromise(this.runQuery(this.currentParams, true));
              }
            } else {
              this.setupSubscription();
            }
          } else if (paramsDidChange) {
            if (this.def.type !== QueryType.Stream) {
              this.debouncedRefetch();
            } else {
              this.setupSubscription();
            }
          }
        },
        deactivate,
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

  private getAllEntityRefs(): Set<number> {
    let allNestedRefIdsSignal = this.allNestedRefIdsSignal;

    if (!allNestedRefIdsSignal) {
      const queryClient = this.queryClient;

      this.allNestedRefIdsSignal = allNestedRefIdsSignal = reactiveSignal(() => {
        // Entangle the relay value. Whenever the relay value is updated, the
        // allNestedRefIdsSignal will be updated, so no need for a second signal.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        this.relay.value;

        const allRefIds = new Set<number>();

        if (this.refIds !== undefined) {
          for (const refId of this.refIds) {
            queryClient.getNestedEntityRefIds(refId, allRefIds);
          }
        }

        return allRefIds;
      });
    }

    return allNestedRefIdsSignal.value;
  }

  /**
   * Initialize the query by loading from cache and fetching if stale
   */
  private async initialize(): Promise<void> {
    const state = this.relayState;

    this.initialized = true;

    let cached: CachedQuery | undefined;

    try {
      // Load from cache first (use storage key for cache operations)
      cached = await this.queryClient.loadCachedQuery(this.def, this.storageKey);

      if (cached !== undefined) {
        // Set the cached timestamp
        this.updatedAt = cached.updatedAt;

        // Set the cached reference IDs
        this.refIds = cached.refIds;

        // Set the value last - this resolves the relay
        const shape = this.def.shape;
        state.value =
          shape instanceof ValidatorDef
            ? parseEntities(cached.value, shape as ComplexTypeDef, this.queryClient, new Set())
            : parseValue(cached.value, shape, this.def.id);
      }
    } catch (error) {
      this.queryClient.deleteCachedQuery(this.storageKey);
      this.queryClient
        .getContext()
        .log?.warn?.('Failed to initialize query, the query cache may be corrupted or invalid', error);
    }

    if (this.isPaused) {
      return;
    }

    try {
      // Setup subscriptions (handles both StreamQuery and Query/InfiniteQuery with stream)
      if (
        this.def.type === QueryType.Stream ||
        (this.def as QueryDefinition<any, any, any> | InfiniteQueryDefinition<any, any, any>).stream
      ) {
        this.setupSubscription();
      }

      // For non-stream queries, fetch if stale or no cache
      if (this.def.type !== QueryType.Stream) {
        if (cached !== undefined) {
          // Check if data is stale
          if (this.isStale) {
            // Data is stale, trigger background refetch (with debounce if configured)
            if (this.def.debounce !== undefined && this.def.debounce > 0) {
              this.debouncedRefetch();
            } else {
              this.refetch();
            }
          }
        } else {
          // No cached data, fetch fresh immediately (don't debounce initial fetch)
          // Debounce only applies to refetches triggered by parameter changes
          state.setPromise(this.runQuery(this.currentParams, true));
        }
      }
    } catch (error) {
      // Relay will handle the error state automatically
      state.setError(error as Error);
    }
  }

  /**
   * Handle stream updates. This method handles both StreamQuery and Query/InfiniteQuery with stream options.
   * - For StreamQuery: directly updates the relay state with the entity
   * - For Query/InfiniteQuery with stream: updates entities in response or adds to orphans
   */
  private setupSubscription(): void {
    this.unsubscribe?.();

    let subscribeFn: StreamSubscribeFn<any, any>;
    let shapeDef: EntityDef;

    if (this.def.type === QueryType.Stream) {
      shapeDef = this.def.shape as EntityDef;
      subscribeFn = this.def.subscribeFn;
    } else {
      const stream = (this.def as QueryDefinition<any, any, any> | InfiniteQueryDefinition<any, any, any>).stream;

      if (!stream) {
        return;
      }

      shapeDef = stream.shape as EntityDef;
      subscribeFn = stream.subscribeFn;
    }

    // Extract params (reading Signal values establishes tracking)
    const extractedParams = this.currentParams;
    this.unsubscribe = subscribeFn(this.queryClient.getContext(), extractedParams as QueryParams, update => {
      const parsedData = parseObjectEntities(update, shapeDef, this.queryClient);

      // Update the relay state
      if (this.def.type === QueryType.Stream) {
        this.relayState.value = parsedData;
        this.updatedAt = Date.now();

        // Cache the data
        // Use storage key for cache operations
        this.queryClient.saveQueryData(this.def, this.storageKey, parsedData, this.updatedAt);
      } else {
        // For Query/InfiniteQuery with stream: we still parse/apply updates into the entity map
        // (via parseObjectEntities above), but we no longer track "orphans" on the query result.
        void getProxyId(parsedData);
      }
    });
  }

  /**
   * Fetches fresh data, updates the cache, and updates updatedAt timestamp
   */
  private async runQuery(params: QueryParams | undefined, reset = false): Promise<T> {
    // Check if paused before attempting fetch
    if (this.isPaused) {
      throw new Error('Query is paused due to network status');
    }

    const { retries, retryDelay } = this.getRetryConfig();
    let lastError: unknown;

    // Attempt fetch with retries
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const queryDef = this.def as QueryDefinition<any, any, any> | InfiniteQueryDefinition<any, any, any>;
        const freshData = await queryDef.fetchFn(this.queryClient.getContext(), params);

        // Parse and cache the fresh data
        let entityRefs;

        const isInfinite = this.def.type === QueryType.InfiniteQuery;

        if (isInfinite && !reset && this.refIds !== undefined) {
          entityRefs = this.refIds;
        } else {
          entityRefs = this.refIds = new Set<number>();
        }

        const shape = this.def.shape;

        const parsedData =
          shape instanceof ValidatorDef
            ? parseEntities(freshData, shape as ComplexTypeDef, this.queryClient, entityRefs)
            : parseValue(freshData, shape, this.def.id);

        let queryData;

        if (isInfinite) {
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
        // Use storage key for cache operations
        this.queryClient.saveQueryData(this.def, this.storageKey, queryData, updatedAt, entityRefs);

        // Update the timestamp
        this.updatedAt = Date.now();

        return queryData as T;
      } catch (error) {
        lastError = error;

        // If we've exhausted retries, throw the error
        if (attempt >= retries) {
          throw error;
        }

        // Wait before retrying (unless paused)
        const delay = retryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));

        // Check if paused during retry delay
        if (this.isPaused) {
          throw new Error('Query is paused due to network status');
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError;
  }

  // ======================================================
  // Private debounce methods
  // ======================================================

  /**
   * Triggers a debounced refetch. If debounce is configured, delays the fetch.
   * Otherwise, calls refetch immediately.
   */
  private debouncedRefetch(): void {
    // We know this is a non-stream query because we're calling refetch, which is only available on non-stream queries
    const debounce = (this.def as QueryDefinition<any, any, any> | InfiniteQueryDefinition<any, any, any>).debounce;

    if (debounce === undefined) {
      this.refetch();
      return;
    }

    // Clear existing timer
    clearTimeout(this.debounceTimer);

    // Set new timer
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.refetch();
    }, debounce);
  }

  // ======================================================
  // Public methods
  // ======================================================

  refetch = (): Promise<T> => {
    if (this.def.type === QueryType.Stream) {
      throw new Error('Cannot refetch a stream query');
    }

    if (this.fetchMorePromise) {
      throw new Error('Query is fetching more, cannot refetch');
    }

    if (this.refetchPromise) {
      return this.refetchPromise;
    }

    // Clear debounce timer if active (manual refetch should bypass debounce)
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;

    // Clear memoized nextPageParams so it's recalculated after refetch
    this._nextPageParams = undefined;

    // Set the signal before any async operations so it's immediately visible
    // Use untrack to avoid reactive violations when called from reactive context
    this.isRefetchingSignal.value = true;
    this._version.update(v => v + 1);

    const promise = this.runQuery(this.currentParams, true)
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
  };

  fetchNextPage = (): Promise<T> => {
    if (this.def.type === QueryType.Stream) {
      throw new Error('Cannot fetch next page on a stream query');
    }

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
  };

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
    // Streams are never stale - they're always receiving updates
    if (this.def.type === QueryType.Stream) {
      return false;
    }

    if (this.updatedAt === undefined) {
      return true; // No data yet, needs fetch
    }

    const staleTime = this.def.cache?.staleTime ?? 0;
    return Date.now() - this.updatedAt >= staleTime;
  }

  get isPaused(): boolean {
    // Streams handle their own connection state
    if (this.def.type === QueryType.Stream) {
      return false;
    }

    const networkMode = this.def.cache?.networkMode ?? NetworkMode.Online;
    const networkManager = this.queryClient.networkManager;

    // Read the online signal to make this reactive
    const isOnline = networkManager.getOnlineSignal().value;

    switch (networkMode) {
      case NetworkMode.Always:
        return false;
      case NetworkMode.Online:
        return !isOnline;
      case NetworkMode.OfflineFirst:
        // Only paused if we have no cached data AND we're offline
        return !isOnline && this.updatedAt === undefined;
      default:
        return false;
    }
  }

  private getRetryConfig(): { retries: number; retryDelay: (attempt: number) => number } {
    // Streams don't have retry config
    if (this.def.type === QueryType.Stream) {
      return { retries: 0, retryDelay: () => 0 };
    }

    const retryOption = this.def.cache?.retry;
    const isServer = this.queryClient.isServer;

    // Default retry count: 3 on client, 0 on server
    let retries: number;
    let retryDelay: (attempt: number) => number;

    if (retryOption === false) {
      retries = 0;
    } else if (retryOption === undefined) {
      retries = isServer ? 0 : 3;
    } else if (typeof retryOption === 'number') {
      retries = retryOption;
    } else {
      retries = retryOption.retries;
    }

    // Default exponential backoff: 1000ms * 2^attempt
    if (typeof retryOption === 'object' && retryOption.retryDelay) {
      retryDelay = retryOption.retryDelay;
    } else {
      retryDelay = (attempt: number) => 1000 * Math.pow(2, attempt);
    }

    return { retries, retryDelay };
  }
}
