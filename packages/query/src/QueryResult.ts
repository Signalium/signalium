import { relay, type RelayState, context, DiscriminatedReactivePromise, type Context, Signal, signal } from 'signalium';
import { hashValue, setReactivePromise } from 'signalium/utils';
import {
  QueryResult,
  EntityDef,
  BaseQueryResult,
  ObjectFieldTypeDef,
  ComplexTypeDef,
  RefetchInterval,
  NetworkMode,
  RetryConfig,
} from './types.js';
import { parseValue } from './proxy.js';
import { parseEntities } from './parseEntities.js';
import { ValidatorDef } from './typeDefs.js';
import {
  InfiniteQueryDefinition,
  QueryDefinition,
  QueryType,
  StreamQueryDefinition,
  type AnyQueryDefinition,
  type QueryClient,
  type QueryParams,
} from './QueryClient.js';

/**
 * QueryResult wraps a DiscriminatedReactivePromise and adds additional functionality
 * like refetch, while forwarding all the base relay properties.
 * This class combines the old QueryInstance and QueryResultImpl into a single entity.
 */
export class QueryResultImpl<T> implements BaseQueryResult<T> {
  def: AnyQueryDefinition<any, any>;
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
  private attemptCount: number = 0;
  private unsubscribe?: () => void = undefined;

  private relay: DiscriminatedReactivePromise<T>;
  private _relayState: RelayState<any> | undefined = undefined;
  private wasOffline: boolean = false;

  private get relayState(): RelayState<any> {
    const relayState = this._relayState;

    if (!relayState) {
      throw new Error('Relay state not initialized');
    }

    return relayState;
  }

  private _nextPageParams: QueryParams | undefined | null = undefined;

  private get nextPageParams(): QueryParams | null {
    // Streams don't have pagination
    if (this.def.type === QueryType.Stream) {
      return null;
    }

    let params = this._nextPageParams;

    const value = this.relayState.value;

    if (params === undefined && value !== undefined) {
      if (!Array.isArray(value)) {
        throw new Error('Query result is not an array, this is a bug');
      }

      const infiniteDef = this.def as InfiniteQueryDefinition<any, any>;
      const nextParams = infiniteDef.pagination?.getNextPageParams?.(value[value.length - 1]);

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
    def: AnyQueryDefinition<any, any>,
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

      // Track network status for reconnect handling
      const networkManager = this.queryClient.networkManager;
      const isOnline = networkManager.getOnlineSignal().value;

      // Store initial offline state
      this.wasOffline = !isOnline;

      if (this.initialized) {
        if (this.def.type === QueryType.Stream) {
          this.setupSubscription();
        } else {
          // Check if we just came back online
          if (!this.wasOffline && isOnline) {
            // We're back online - check if we should refresh
            const refreshStaleOnReconnect = this.def.cache?.refreshStaleOnReconnect ?? true;
            if (refreshStaleOnReconnect && this.isStale) {
              this.refetch();
            }
            // Reset attempt count on reconnect
            this.attemptCount = 0;
          } else if (this.isStale && !this.isPaused) {
            this.refetch();
          }
        }
        // Update wasOffline for next check
        this.wasOffline = !isOnline;
      } else {
        this.initialize();
      }

      // Return deactivation callback
      return {
        update: () => {
          // For streams, unsubscribe and resubscribe to re-establish connection
          if (this.def.type === QueryType.Stream) {
            this.setupSubscription();
            return;
          }

          // Network status changed - check if we should react
          const currentlyOnline = networkManager.getOnlineSignal().value;

          // If we just came back online
          if (this.wasOffline && currentlyOnline) {
            const refreshStaleOnReconnect = this.def.cache?.refreshStaleOnReconnect ?? true;
            if (refreshStaleOnReconnect && this.isStale) {
              state.setPromise(this.runQuery(this.params, true));
            }
            // Reset attempt count on reconnect
            this.attemptCount = 0;
          }

          // Update wasOffline for next check
          this.wasOffline = !currentlyOnline;
        },
        deactivate: () => {
          // Last subscriber left, deactivate refetch and schedule memory eviction
          if (this.def.type === QueryType.Stream) {
            // Unsubscribe from stream
            if (this.unsubscribe) {
              this.unsubscribe();
              this.unsubscribe = undefined;
            }
          } else if (this.def.cache?.refetchInterval) {
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
      }

      if (this.def.type === QueryType.Stream) {
        this.setupSubscription();
      } else {
        if (cached !== undefined) {
          // Check if data is stale
          if (this.isStale) {
            // Data is stale, trigger background refetch
            this.refetch();
          }
        } else {
          // No cached data, fetch fresh
          state.setPromise(this.runQuery(this.params, true));
        }
      }
    } catch (error) {
      // Relay will handle the error state automatically
      state.setError(error as Error);
    }
  }

  /**
   * Handle stream updates by merging with existing entity.
   * Deep merging is handled automatically by parseEntities/setEntity.
   */
  private setupSubscription(): void {
    this.unsubscribe?.();

    const streamDef = this.def as StreamQueryDefinition<any, any>;
    this.unsubscribe = streamDef.subscribeFn(this.queryClient.getContext(), this.params, update => {
      const shapeDef = this.def.shape as EntityDef;
      const entityRefs = this.refIds ?? new Set<number>();

      const parsedData = parseEntities(update, shapeDef as ComplexTypeDef, this.queryClient, entityRefs);

      // Update the relay state
      this.relayState.value = parsedData;
      this.updatedAt = Date.now();
      this.refIds = entityRefs;

      // Cache the data
      this.queryClient.saveQueryData(this.def, this.queryKey, parsedData, this.updatedAt, entityRefs);
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
        const queryDef = this.def as QueryDefinition<any, any> | InfiniteQueryDefinition<any, any>;
        const freshData = await queryDef.fetchFn(this.queryClient.getContext(), params);

        // Success! Reset attempt count
        this.attemptCount = 0;

        // Parse and cache the fresh data
        let entityRefs;

        const isInfinite = this.def.type === QueryType.InfiniteQuery;

        if (isInfinite && !reset && this.refIds !== undefined) {
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
        this.queryClient.saveQueryData(this.def, this.queryKey, queryData, updatedAt, entityRefs);

        // Update the timestamp
        this.updatedAt = Date.now();

        return queryData as T;
      } catch (error) {
        lastError = error;
        this.attemptCount = attempt + 1;

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
