import { relay, type RelayState, DiscriminatedReactivePromise, notifier, type Notifier } from 'signalium';
import { type InternalTypeDef, EntityDef, ComplexTypeDef, Mask, NetworkMode, type QueryResult } from './types.js';
import { parseValue } from './proxy.js';
import { parseEntities, parseObjectEntities } from './parseEntities.js';
import { ValidatorDef } from './typeDefs.js';
import { type QueryClient, type QueryParams, extractParamsForKey, queryKeyFor } from './QueryClient.js';
import { CachedQuery } from './QueryClient.js';
import { Query, QueryDefinition, StreamSubscribeFn } from './query.js';

// ======================================================
// QueryInstance
// ======================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Internal query manager. Consumers interact with the public `relay` property,
 * which is a standard ReactivePromise whose value is a persistent proxy over
 * the parsed response data. The proxy entangles a notifier on property access
 * so consumers re-evaluate when data changes. Query controls (`__refetch`, and
 * eventually `__loadMore`, `__isLoadingMore`) are intercepted by the proxy.
 */
export class QueryInstance<T extends Query> {
  def: QueryDefinition<any, any, any>;
  queryKey: number;
  storageKey: number = -1;

  /** The public-facing ReactivePromise returned to consumers. */
  readonly relay: DiscriminatedReactivePromise<QueryResult<T>>;

  private queryClient: QueryClient;
  private initialized: boolean = false;
  private updatedAt: number | undefined = undefined;
  private params: QueryParams | undefined = undefined;

  private unsubscribe?: () => void = undefined;

  private _relayState: RelayState<QueryResult<T>> | undefined = undefined;
  private wasPaused: boolean = false;
  private currentParams: QueryParams | undefined = undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  /** Whether the response type supports the persistent proxy pattern (objects/entities). */
  private _useProxy: boolean;
  /** The current parsed response data backing the persistent proxy. */
  private _data: QueryResult<T> | undefined = undefined;
  /** Notifier that is consumed on proxy property access and notified on data updates. */
  private _notifier: Notifier = notifier();
  /** The persistent proxy that is set as the relay value once and never changes (only for object types). */
  private _proxy: QueryResult<T> | undefined;

  private get relayState(): RelayState<QueryResult<T>> {
    const relayState = this._relayState;

    if (!relayState) {
      throw new Error('Relay state not initialized');
    }

    return relayState;
  }

  constructor(
    def: QueryDefinition<any, any, any>,
    queryClient: QueryClient,
    queryKey: number,
    params: QueryParams | undefined,
  ) {
    this.def = def;
    this.queryClient = queryClient;
    this.queryKey = queryKey;
    this.params = params;

    this._useProxy = isProxiableShape(this.def.shape);
    this._proxy = this._useProxy ? createQueryProxy<T>(this) : undefined;

    // Create the relay whose value is the persistent proxy, set once on first data
    this.relay = relay<QueryResult<any>>(state => {
      this._relayState = state;

      // Load from cache first, then fetch fresh data
      this.queryClient.activateQuery(this);

      const deactivate = () => {
        // Clear debounce timer if active
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;

        // Last subscriber left, deactivate refetch and schedule memory eviction
        // Unsubscribe from any active streams
        this.unsubscribe?.();
        this.unsubscribe = undefined;

        if (this.def.cache?.refetchInterval) {
          this.queryClient.refetchManager.removeQuery(this);
        }

        // Schedule removal from memory using the global eviction manager
        // This allows quick reactivation from memory if needed again soon
        // Disk cache (if configured) will still be available after eviction
        // Use queryKey for instance eviction, storageKey for cache eviction
        this.queryClient.memoryEvictionManager.scheduleEviction(this.queryKey);
      };

      const update = (activating: boolean = false) => {
        const { wasPaused, isPaused, initialized } = this;
        this.wasPaused = isPaused;

        if (isPaused && !wasPaused && initialized) {
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
          this.currentParams = newExtractedParams as QueryParams;
          this.storageKey = newStorageKey;
        }

        if (!this.initialized) {
          this.initialize();
        } else if (wasPaused || activating) {
          this.queryClient.activateQuery(this);

          if (activating) {
            this.setupSubscription();
          }

          const refreshStaleOnReconnect = this.def.cache?.refreshStaleOnReconnect ?? true;
          if (refreshStaleOnReconnect && this.isStale) {
            this.runDebounced();
          }
        } else if (paramsDidChange) {
          this.runDebounced();
        }
      };

      update(true);

      return {
        update,
        deactivate,
      };
    });
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

        const shape = this.def.shape;
        if (shape instanceof ValidatorDef) {
          this._data = parseEntities(
            cached.value,
            shape as ComplexTypeDef,
            this.queryClient,
            new Set(),
          ) as QueryResult<T>;
        } else {
          this._data = parseValue(cached.value, shape as any, this.def.id) as QueryResult<T>;
        }

        // Resolve the relay with the persistent proxy (object types) or raw data
        state.value = this._useProxy ? this._proxy! : (this._data as QueryResult<T>);
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
      this.setupSubscription();

      if (cached === undefined || this.isStale) {
        await sleep(0);
        this.runQueryImmediately();
      }
    } catch (error) {
      state.setError(error as Error);
    }
  }

  /**
   * Handle stream updates for queries with stream options.
   */
  private setupSubscription(): void {
    const stream = this.def.stream;

    if (!stream) {
      return;
    }

    this.unsubscribe?.();

    const shapeDef: EntityDef = stream.shape as EntityDef;
    const subscribeFn: StreamSubscribeFn<any, any> = stream.subscribeFn;

    const extractedParams = this.currentParams;
    this.unsubscribe = subscribeFn(this.queryClient.getContext(), extractedParams as QueryParams, update => {
      parseObjectEntities(update, shapeDef, this.queryClient);
    });
  }

  /**
   * Fetches fresh data, updates the cache, and updates updatedAt timestamp
   */
  private async runQuery(params: QueryParams | undefined): Promise<QueryResult<T>> {
    // Check if paused before attempting fetch
    if (this.isPaused) {
      throw new Error('Query is paused due to network status');
    }

    const { retries, retryDelay } = this.def.retryConfig;
    let lastError: unknown;

    // Attempt fetch with retries
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const queryDef = this.def as QueryDefinition<any, any, any>;
        const freshData = await queryDef.fetchFn(this.queryClient.getContext(), params);

        const entityRefs = new Set<number>();

        const shape = this.def.shape;

        const parsedData =
          shape instanceof ValidatorDef
            ? parseEntities(freshData, shape as ComplexTypeDef, this.queryClient, entityRefs)
            : parseValue(freshData, shape as any, this.def.id);

        const updatedAt = (this.updatedAt = Date.now());

        this.queryClient.saveQueryData(this.def, this.storageKey, parsedData, updatedAt, entityRefs);

        // Update the underlying data and notify consumers
        this._data = parsedData as QueryResult<T>;

        if (this._useProxy) {
          this._notifier.notify();
          return this._proxy!;
        } else {
          return parsedData as unknown as QueryResult<T>;
        }
      } catch (error) {
        lastError = error;

        // If we've exhausted retries, throw the error
        if (attempt >= retries) {
          throw error;
        }

        // Wait before retrying (unless paused)
        const delay = retryDelay(attempt);
        await sleep(delay);

        // Check if paused during retry delay
        if (this.isPaused) {
          throw new Error('Query is paused due to network status');
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError;
  }

  private runQueryImmediately(): void {
    this.relayState.setPromise(this.runQuery(this.currentParams));
  }

  /**
   * Schedules a fetch via the debounce timer (delay defaults to 0 if not
   * configured). Resets the timer on each call so rapid invocations coalesce.
   */
  private runDebounced(): void {
    if (this.relayState.isPending) return;

    const debounce = this.def.debounce ?? 0;

    clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.runQueryImmediately();
    }, debounce);
  }

  // ======================================================
  // Public methods
  // ======================================================

  refetch = (): DiscriminatedReactivePromise<QueryResult<T>> => {
    if (this.relayState.isPending) return this.relay;
    this.runQueryImmediately();
    return this.relay;
  };

  // ======================================================
  // Internal computed properties
  // ======================================================

  private get isStale(): boolean {
    if (this.updatedAt === undefined) {
      return true;
    }

    const staleTime = this.def.cache?.staleTime ?? 0;
    return Date.now() - this.updatedAt >= staleTime;
  }

  private get isPaused(): boolean {
    const networkMode = this.def.cache?.networkMode ?? NetworkMode.Online;

    if (networkMode === NetworkMode.Always) {
      return false;
    }

    const isOnline = this.queryClient.networkManager.getOnlineSignal().value;

    switch (networkMode) {
      case NetworkMode.Online:
        return !isOnline;
      case NetworkMode.OfflineFirst:
        return !isOnline && this.updatedAt === undefined;
      default:
        return false;
    }
  }
}

// ======================================================
// Persistent proxy over query result data
// ======================================================

function createQueryProxy<T extends Query>(instance: QueryInstance<T>): QueryResult<T> {
  const target = {} as QueryResult<T>;

  return new Proxy(target, {
    get(_target, prop) {
      if (prop === '__refetch') return instance.refetch;

      instance['_notifier'].consume();

      const data = instance['_data'];
      if (data === undefined) return undefined;

      const value = (data as any)[prop];

      // Bind array/object methods so they operate on the real data
      if (typeof value === 'function') {
        return value.bind(data);
      }

      return value;
    },

    has(_target, prop) {
      if (prop === '__refetch') return true;

      instance['_notifier'].consume();

      const data = instance['_data'];
      if (data === undefined) return false;
      if (typeof data !== 'object' || data === null) return false;

      return prop in (data as any) || prop === '__refetch';
    },

    ownKeys() {
      instance['_notifier'].consume();

      const data = instance['_data'];
      if (data === undefined || typeof data !== 'object' || data === null) return [];

      const keys = ['__refetch', ...Reflect.ownKeys(data as any)];

      return keys;
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (prop === '__refetch') {
        return { enumerable: true, configurable: true };
      }

      instance['_notifier'].consume();

      const data = instance['_data'];
      if (data === undefined || typeof data !== 'object' || data === null) return undefined;

      return Reflect.getOwnPropertyDescriptor(data as any, prop);
    },

    getPrototypeOf() {
      const data = instance['_data'];
      if (data === undefined) return Object.prototype;
      if (typeof data !== 'object' || data === null) return Object.getPrototypeOf(data);

      return Reflect.getPrototypeOf(data as any);
    },
  });
}

// ======================================================
// Shape type checking
// ======================================================

function isProxiableShape(shape: InternalTypeDef): boolean {
  if (shape instanceof ValidatorDef) {
    // Use bitwise AND since mask may include additional flags (e.g. HAS_SUB_ENTITY)
    return (shape.mask & (Mask.OBJECT | Mask.ENTITY | Mask.RECORD | Mask.UNION)) !== 0;
  }
  // Numbers (Mask) and Sets (enum/const) represent primitive types - not proxiable
  return false;
}
