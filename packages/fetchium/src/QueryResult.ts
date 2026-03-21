import { relay, type RelayState, DiscriminatedReactivePromise } from 'signalium';
import { NetworkMode, type QueryResult, type EntityDef } from './types.js';
import {
  type QueryClient,
  type QueryParams,
  type QueryConfigOptions,
  extractParamsForKey,
  queryKeyFor,
  CachedQuery,
} from './QueryClient.js';
import { DEFAULT_GC_TIME } from './stores/shared.js';
import { GcKeyType } from './GcManager.js';
import { Query, QueryDefinition, type ResolvedRetryConfig, resolveRetryConfig } from './query.js';
import { EntityInstance } from './EntityInstance.js';
import { hashValue } from 'signalium/utils';
import { sleep, withRetry } from './retry.js';

/**
 * Thin fetch/relay orchestrator. Data management (proxy, notifier, child refs,
 * live collections) is fully delegated to a root EntityInstance.
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

  /** Resolved per-instance options (depend on actual params). */
  config: QueryConfigOptions | undefined = undefined;
  retryConfig: ResolvedRetryConfig = resolveRetryConfig(undefined);

  /** The raw fetch Response from the most recent successful fetch. */
  private _lastResponse: Response | undefined = undefined;

  /** Controller for aborting in-flight fetches and retry waits. */
  private _abortController: AbortController | undefined = undefined;

  /** Cached execution context, recreated only when storageKey (params) changes. */
  private _executionCtx: Query | undefined = undefined;
  private _executionCtxKey: number = -1;

  /** Root entity that holds parsed data, proxy, child refs, and bindings.
   *  For entity results, this is undefined until the first apply discovers it. */
  rootEntity: EntityInstance | undefined;

  /** Extra methods (__refetch, __loadNext) attached to the root entity proxy. */
  private _extraMethods: Record<string, (...args: unknown[]) => unknown> = {};

  /** Query id injected as QUERY_ID on non-entity payloads. */
  private _queryId: number = 0;

  get key(): number {
    return this.queryKey;
  }

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

    this._extraMethods = { __refetch: this.refetch };
    if (def.statics.hasSendNext) {
      this._extraMethods.__loadNext = this.loadNext;
    }

    // Compute the query id used for QUERY_ID injection on non-entity results.
    const extractedParams = extractParamsForKey(params);
    this._queryId = extractedParams !== undefined ? hashValue(extractedParams) : 0;

    // Create the relay whose value is the root entity's proxy (stable identity)
    this.relay = relay<QueryResult<T>>(
      state => {
        this._relayState = state;

        const deactivate = () => {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = undefined;

          this._abortController?.abort();
          this._abortController = undefined;

          this._loadNextAbort?.abort();
          this._loadNextAbort = undefined;
          this._loadNextPromise = undefined;

          this.unsubscribe?.();
          this.unsubscribe = undefined;

          const gcTime = this.config?.gcTime ?? DEFAULT_GC_TIME;
          this.queryClient.gcManager.schedule(this.queryKey, gcTime, GcKeyType.Query);
        };

        const update = (activating: boolean = false) => {
          const { wasPaused, isPaused, initialized } = this;
          this.wasPaused = isPaused;

          if (isPaused && !wasPaused && initialized) {
            deactivate();
            return;
          }

          const newExtractedParams = extractParamsForKey(this.params);
          const newStorageKey = queryKeyFor(this.def, newExtractedParams);

          const paramsDidChange = newStorageKey !== this.storageKey;

          if (paramsDidChange) {
            this.currentParams = newExtractedParams as QueryParams;
            this.storageKey = newStorageKey;
          }

          this.getOrCreateExecutionContext();

          if (!this.initialized) {
            this.queryClient.activateQuery(this);
            this.initialize();
          } else if (wasPaused || activating) {
            this.queryClient.activateQuery(this);

            if (activating && this.updatedAt !== undefined) {
              this.setupSubscription();
            }

            const refreshStaleOnReconnect = this.config?.refreshStaleOnReconnect ?? true;
            if (refreshStaleOnReconnect && this.isStale) {
              this.runDebounced();
            }
          } else if (paramsDidChange) {
            this.setupSubscription();
            this.runDebounced();
          }
        };

        update(true);

        return {
          update,
          deactivate,
        };
      },
      { desc: `Query(${def.statics.id})` },
    );
  }

  /** Apply raw data (fresh or cached) to the root entity and return the proxy. */
  private applyData(
    data: unknown,
    persist: boolean,
    appendMode: boolean = false,
    preloadedEntities?: import('./query-types.js').PreloadedEntityMap,
  ): QueryResult<T> {
    const def = this.def;
    this.rootEntity = this.queryClient.parseAndApplyRootEntity(
      data,
      this._queryId,
      def.statics.shape,
      persist,
      appendMode,
      preloadedEntities,
    );

    // Attach extra methods and getters on first discovery
    if (this.rootEntity._extraMethods === undefined) {
      this.rootEntity._extraMethods = this._extraMethods;
      this.rootEntity._extraGetters = {
        __hasNext: () => this.hasNext,
        __isLoadingNext: () => this._loadNextPromise !== undefined,
      };
    }

    return this.rootEntity.getProxy(def.statics.shape as unknown as EntityDef) as QueryResult<T>;
  }

  /** Save query metadata (the __entityRef pointer, updatedAt, ref set). */
  private saveQueryMetadata(): void {
    if (this.rootEntity === undefined || this.updatedAt === undefined) return;
    const refs = new Map(this.rootEntity.entityRefs ?? []);
    refs.set(this.rootEntity, 1);
    this.queryClient.saveQueryData(
      this.def,
      this.storageKey,
      { __entityRef: this.rootEntity.key },
      this.updatedAt,
      refs,
    );
  }

  private async initialize(): Promise<void> {
    const qc = this.queryClient;
    const state = this.relayState;

    this.initialized = true;

    let cached: CachedQuery | undefined;

    try {
      cached = await qc.loadCachedQuery(this.def, this.storageKey);

      if (cached !== undefined) {
        this.updatedAt = cached.updatedAt;
        state.value = this.applyData(cached.value, false, false, cached.preloadedEntities);
      }
    } catch (error) {
      qc.store.deleteQuery(this.storageKey);
      qc.getContext().log?.warn?.('Failed to initialize query, the query cache may be corrupted or invalid', error);
    }

    if (this.isPaused) {
      return;
    }

    try {
      if (cached !== undefined) {
        this.setupSubscription();
      }

      if (cached === undefined || this.isStale) {
        await sleep(0);
        if (this.isPaused) return;
        this.runQueryImmediately();
      }
    } catch (error) {
      state.setError(error as Error);
    }
  }

  private setupSubscription(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    const subscribeFn = this.config?.subscribe;
    if (!subscribeFn) return;

    const ctx = this._executionCtx;
    this.unsubscribe = subscribeFn.call(ctx, (event: import('./types.js').MutationEvent) => {
      event.__eventSource = this.queryKey;
      this.queryClient.applyMutationEvent(event);
    });
  }

  private getOrCreateExecutionContext(): Query {
    if (this._executionCtx === undefined || this._executionCtxKey !== this.storageKey) {
      this._executionCtxKey = this.storageKey;
      this._executionCtx = this.def.createExecutionContext(
        (this.currentParams ?? {}) as Record<string, unknown>,
        this.queryClient.getContext(),
      );
      this._executionCtx.refetch = () => this.refetch();
      this._executionCtx.rawLoadNext = this.def.statics.rawLoadNext;
    }

    this._executionCtx.response = this._lastResponse;
    this.resolveAndApplyOptions();

    return this._executionCtx;
  }

  private resolveAndApplyOptions(): void {
    const resolved = this.def.resolveOptions(this._executionCtx!);
    this.config = resolved.config;
    this.retryConfig = resolved.retryConfig;
  }

  private async runQuery(): Promise<QueryResult<T>> {
    const def = this.def;

    if (this.isPaused) {
      throw new Error('Query is paused due to network status');
    }

    const ctx = this.getOrCreateExecutionContext();
    const { send } = def.captured.methods;
    const signal = this._abortController?.signal;

    ctx.signal = signal!;

    return withRetry(
      async () => {
        const freshData = await send.call(ctx);

        this._lastResponse = ctx.response;
        this._executionCtx!.response = this._lastResponse;
        this.resolveAndApplyOptions();

        this.updatedAt = Date.now();

        const result = this.applyData(freshData, true);
        this.saveQueryMetadata();

        if (this.unsubscribe === undefined) {
          this.setupSubscription();
        }

        return result;
      },
      this.retryConfig,
      signal,
    );
  }

  private runQueryImmediately(): void {
    this._abortController?.abort();
    this._abortController = new AbortController();
    this._loadNextAbort?.abort();
    this._loadNextAbort = undefined;
    this._loadNextPromise = undefined;
    this.relayState.setPromise(this.runQuery());
  }

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

  /** In-flight loadNext promise for deduplication. */
  private _loadNextPromise: Promise<QueryResult<T>> | undefined = undefined;

  /** Controller for aborting in-flight loadNext requests. */
  private _loadNextAbort: AbortController | undefined = undefined;

  loadNext = (): Promise<QueryResult<T>> => {
    if (this.updatedAt === undefined) {
      throw new Error('Cannot call __loadNext before initial data has loaded');
    }
    if (this._loadNextPromise !== undefined) {
      return this._loadNextPromise;
    }
    // Schedule notification so __isLoadingNext becomes true reactively.
    // Must be async to avoid "dirtied after consumed" when called from
    // within a reactive context (the proxy consumes the notifier on access).
    queueMicrotask(() => this.rootEntity?.notify());
    this._loadNextPromise = this.runLoadNext().then(
      result => {
        this._loadNextPromise = undefined;
        // Notify so __isLoadingNext transitions to false.
        // applyData already notified for the data change; this second
        // notify is needed because _loadNextPromise was still set at
        // that point and is only cleared here.
        this.rootEntity?.notify();
        return result;
      },
      error => {
        this._loadNextPromise = undefined;
        this.rootEntity?.notify();
        throw error;
      },
    );
    return this._loadNextPromise;
  };

  private get hasNext(): boolean {
    if (this.rootEntity === undefined || !this._executionCtx) return false;
    const hasNextFn = this.def.captured.methods.hasNext;
    if (!hasNextFn) return false;
    this._executionCtx.resultData = this.rootEntity.data;
    return hasNextFn.call(this._executionCtx);
  }

  private async runLoadNext(): Promise<QueryResult<T>> {
    const def = this.def;
    this._loadNextAbort = new AbortController();
    const signal = this._loadNextAbort.signal;
    const ctx = this.getOrCreateExecutionContext();
    ctx.signal = signal;
    ctx.resultData = this.rootEntity!.data;
    const sendNext = def.captured.methods.sendNext!;

    return withRetry(
      async () => {
        const freshData = await sendNext.call(ctx);

        this._lastResponse = ctx.response;
        this._executionCtx!.response = this._lastResponse;
        this.resolveAndApplyOptions();

        this.updatedAt = Date.now();

        const result = this.applyData(freshData, true, true);
        this.saveQueryMetadata();

        return result;
      },
      this.retryConfig,
      signal,
    );
  }

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
