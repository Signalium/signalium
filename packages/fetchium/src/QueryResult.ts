import { relay, type RelayState, DiscriminatedReactivePromise, notifier, type Notifier } from 'signalium';
import { type InternalTypeDef, EntityDef, ComplexTypeDef, Mask, NetworkMode, type QueryResult } from './types.js';
import { ValidatorDef } from './typeDefs.js';
import {
  type QueryClient,
  type QueryParams,
  type QueryConfigOptions,
  extractParamsForKey,
  queryKeyFor,
} from './QueryClient.js';
import { CachedQuery } from './QueryClient.js';
import {
  Query,
  QueryDefinition,
  type StreamSubscribeFn,
  type ResolvedStreamOptions,
  type ResolvedRetryConfig,
  resolveRetryConfig,
} from './query.js';

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

  /** Root entity keys referenced by the most recent query result. */
  entityRefs: Set<number> | undefined = undefined;

  /** Resolved per-instance options (depend on actual params). */
  config: QueryConfigOptions | undefined = undefined;
  stream: ResolvedStreamOptions | undefined = undefined;
  retryConfig: ResolvedRetryConfig = resolveRetryConfig(undefined);

  /** The raw fetch Response from the most recent successful fetch. */
  private _lastResponse: Response | undefined = undefined;

  /** Cached execution context, recreated only when storageKey (params) changes. */
  private _executionCtx: Query | undefined = undefined;
  private _executionCtxKey: number = -1;

  private get relayState(): RelayState<QueryResult<T>> {
    if (IS_DEV && !this._relayState) {
      throw new Error('Relay state not initialized');
    }
    return this._relayState!;
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

    this._useProxy = isProxiableShape(this.def.statics.shape);
    this._proxy = this._useProxy ? createQueryProxy<T>(this) : undefined;

    // Create the relay whose value is the persistent proxy, set once on first data
    this.relay = relay<QueryResult<any>>(state => {
      this._relayState = state;

      const deactivate = () => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;

        this.unsubscribe?.();
        this.unsubscribe = undefined;

        if (this.config?.refetchInterval) {
          this.queryClient.refetchManager.removeQuery(this);
        }

        this.queryClient.scheduleQueryEviction(this);
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
          this.currentParams = newExtractedParams as QueryParams;
          this.storageKey = newStorageKey;
        }

        // Resolve execution context and param-dependent options
        this.getOrCreateExecutionContext();

        if (!this.initialized) {
          this.queryClient.activateQuery(this);
          this.initialize();
        } else if (wasPaused || activating) {
          this.queryClient.activateQuery(this);

          if (activating) {
            this.setupSubscription();
          }

          const refreshStaleOnReconnect = this.config?.refreshStaleOnReconnect ?? true;
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
    const qc = this.queryClient;
    const state = this.relayState;

    this.initialized = true;

    let cached: CachedQuery | undefined;

    try {
      // Load from cache first (use storage key for cache operations)
      cached = await qc.loadCachedQuery(this.def, this.storageKey);

      if (cached !== undefined) {
        this.updatedAt = cached.updatedAt;

        const entityRefs = cached.refIds ?? new Set<number>();
        this._data = qc.parseEntities(
          cached.value,
          this.def.statics.shape,
          undefined,
          cached.preloadedEntities,
        ) as QueryResult<T>;

        qc.updateEntityRefs(this.entityRefs, entityRefs);
        this.entityRefs = entityRefs.size > 0 ? entityRefs : undefined;

        state.value = this._useProxy ? this._proxy! : (this._data as QueryResult<T>);
      }
    } catch (error) {
      qc.deleteCachedQuery(this.storageKey);
      qc.getContext().log?.warn?.('Failed to initialize query, the query cache may be corrupted or invalid', error);
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
    const stream = this.stream;

    if (!stream) {
      return;
    }

    this.unsubscribe?.();

    const shapeDef: EntityDef = stream.shape as EntityDef;
    const subscribeFn: StreamSubscribeFn<any, any> = stream.subscribeFn;

    const extractedParams = this.currentParams;
    this.unsubscribe = subscribeFn(this.queryClient.getContext(), extractedParams as QueryParams, update => {
      this.queryClient.parseEntities(update, shapeDef);
    });
  }

  private getOrCreateExecutionContext(): Query {
    if (this._executionCtx === undefined || this._executionCtxKey !== this.storageKey) {
      this._executionCtxKey = this.storageKey;
      this._executionCtx = this.def.createExecutionContext(
        (this.currentParams ?? {}) as Record<string, unknown>,
        this.queryClient.getContext(),
      );
    }

    this._executionCtx.response = this._lastResponse;
    this.resolveAndApplyOptions();

    return this._executionCtx;
  }

  private resolveAndApplyOptions(): void {
    const resolved = this.def.resolveOptions(this._executionCtx!);
    this.config = resolved.config;
    this.stream = resolved.stream;
    this.retryConfig = resolved.retryConfig;
  }

  /**
   * Fetches fresh data, updates the cache, and updates updatedAt timestamp
   */
  private async runQuery(params: QueryParams | undefined): Promise<QueryResult<T>> {
    const qc = this.queryClient;
    const def = this.def;

    if (this.isPaused) {
      throw new Error('Query is paused due to network status');
    }

    const ctx = this.getOrCreateExecutionContext();
    const { send } = def.captured.methods;

    const { retries, retryDelay } = this.retryConfig;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const freshData = await send.call(ctx);

        this._lastResponse = ctx.response;
        this._executionCtx!.response = this._lastResponse;
        this.resolveAndApplyOptions();

        const entityRefs = new Set<number>();

        const parsedData = qc.parseEntities(freshData, def.statics.shape, entityRefs);

        const updatedAt = (this.updatedAt = Date.now());

        qc.saveQueryData(def, this.storageKey, parsedData, updatedAt, entityRefs);

        qc.updateEntityRefs(this.entityRefs, entityRefs);
        this.entityRefs = entityRefs.size > 0 ? entityRefs : undefined;

        this._data = parsedData as QueryResult<T>;

        if (this._useProxy) {
          this._notifier.notify();
          return this._proxy!;
        } else {
          return parsedData as unknown as QueryResult<T>;
        }
      } catch (error) {
        lastError = error;

        if (attempt >= retries) {
          throw error;
        }

        const delay = retryDelay(attempt);
        await sleep(delay);

        if (this.isPaused) {
          throw new Error('Query is paused due to network status');
        }
      }
    }

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

    const debounce = this.config?.debounce ?? 0;

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

    const staleTime = this.config?.staleTime ?? 0;
    return Date.now() - this.updatedAt >= staleTime;
  }

  private get isPaused(): boolean {
    const networkMode = this.config?.networkMode ?? NetworkMode.Online;

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
  const notifier = instance['_notifier'];
  const getData = () => instance['_data'];
  const REFETCH = '__refetch';

  return new Proxy(target, {
    get(_target, prop) {
      if (prop === REFETCH) return instance.refetch;

      notifier.consume();

      const data = getData();
      if (data === undefined) return undefined;

      const value = (data as any)[prop];

      // Bind array/object methods so they operate on the real data
      if (typeof value === 'function') {
        return value.bind(data);
      }

      return value;
    },

    has(_target, prop) {
      if (prop === REFETCH) return true;

      notifier.consume();

      const data = getData();
      if (data === undefined) return false;
      if (typeof data !== 'object' || data === null) return false;

      return prop in (data as any);
    },

    ownKeys() {
      notifier.consume();

      const data = getData();
      if (data === undefined || typeof data !== 'object' || data === null) return [];

      const keys = [REFETCH, ...Reflect.ownKeys(data as any)];

      return keys;
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (prop === REFETCH) {
        return { enumerable: true, configurable: true };
      }

      notifier.consume();

      const data = getData();
      if (data === undefined || typeof data !== 'object' || data === null) return undefined;

      return Reflect.getOwnPropertyDescriptor(data as any, prop);
    },

    getPrototypeOf() {
      const data = getData();
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
