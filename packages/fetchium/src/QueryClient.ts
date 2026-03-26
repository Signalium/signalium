import { context, ReactiveTask, type Context } from 'signalium';
import { hashValue } from 'signalium/utils';
import { EntityDef, MutationEvent, QueryPromise, ComplexTypeDef, InternalTypeDef, QUERY_ID } from './types.js';
import { PROXY_ID } from './proxyId.js';
import { EntityStore } from './EntityStore.js';
import { EntityInstance } from './EntityInstance.js';
import { NetworkManager } from './NetworkManager.js';
import { QueryInstance } from './QueryResult.js';
import { MutationResultImpl } from './MutationResult.js';
import { MutationDefinition } from './mutation.js';
import { GcManager, NoOpGcManager, GcKeyType } from './GcManager.js';
import { DEFAULT_GC_TIME } from './stores/shared.js';
import { Query, QueryDefinition } from './query.js';
import { ParseContext, parseEntities, parseEntity, type ParseResult } from './parseEntities.js';
import { applyEntityRefs, type ApplyResult } from './applyEntities.js';
import { ValidatorDef } from './typeDefs.js';
import { ConstraintMatcher, EVENT_SOURCE_FIELD } from './ConstraintMatcher.js';
import { LiveCollectionBinding } from './LiveCollection.js';
import {
  type QueryContext,
  type QueryStore,
  type QueryParams,
  type PreloadedEntityMap,
  queryKeyFor,
} from './query-types.js';

export {
  type QueryContext,
  type QueryCacheOptions,
  type QueryConfigOptions,
  type LoadNextConfig,
  type QueryParams,
  type QueryStore,
  type CachedQuery,
  type PreloadedEntityMap,
  type MaybePromise,
  resolveBaseUrl,
  extractParamsForKey,
  queryKeyFor,
} from './query-types.js';

export class QueryClient {
  entityMap: EntityStore;
  queryInstances = new Map<number, QueryInstance<any>>();
  mutationInstances = new Map<string, MutationResultImpl<unknown, unknown>>();
  gcManager: GcManager | NoOpGcManager;
  networkManager: NetworkManager;
  isServer: boolean;
  store: QueryStore;

  currentParseId: number = 0;

  private typenameRegistry = new Map<string, ValidatorDef<any>[]>();
  private constraintRegistry = new Map<string, ConstraintMatcher>();
  private mergedDefCache = new Map<string, ValidatorDef<any>>();

  constructor(
    store: QueryStore,
    private context: QueryContext = { fetch, log: console },
    networkManager?: NetworkManager,
    gcManager?: GcManager | NoOpGcManager,
  ) {
    this.isServer = typeof window === 'undefined';
    this.store = store;
    this.gcManager =
      gcManager ??
      (this.isServer ? new NoOpGcManager() : new GcManager(this.handleEviction, this.context.evictionMultiplier));
    this.networkManager = networkManager ?? new NetworkManager();
    this.entityMap = new EntityStore((key, data, refs) => this.store.saveEntity(key, data, refs));

    this.store.purgeStaleQueries?.();
  }

  getContext(): QueryContext {
    return this.context;
  }

  // ======================================================
  // Typename Registry (per-client)
  // ======================================================

  private registerEntityDef(def: ValidatorDef<any>): void {
    const typename = def.typenameValue;
    if (typename === undefined) return;
    if (def._entityClass === undefined) return;

    const existing = this.typenameRegistry.get(typename);

    if (existing !== undefined) {
      if (existing.indexOf(def) !== -1) return;

      existing.push(def);
      this.mergedDefCache.delete(typename);
      this.getMergedDef(typename);
    } else {
      this.typenameRegistry.set(typename, [def]);
    }
  }

  getEntityDefsForTypename(typename: string): ValidatorDef<any>[] | undefined {
    return this.typenameRegistry.get(typename);
  }

  getMergedDef(typename: string): ValidatorDef<any> | undefined {
    let merged = this.mergedDefCache.get(typename);
    if (merged !== undefined) return merged;

    const defs = this.typenameRegistry.get(typename);
    if (defs === undefined) return undefined;

    merged = ValidatorDef.merge(defs);
    this.mergedDefCache.set(typename, merged);
    return merged;
  }

  saveQueryData(
    queryDef: QueryDefinition<QueryParams | undefined, unknown, unknown>,
    queryKey: number,
    data: unknown,
    updatedAt: number,
    entityRefs?: Map<EntityInstance, number>,
  ): void {
    const refKeys =
      entityRefs !== undefined && entityRefs.size > 0
        ? new Set<number>([...entityRefs.keys()].map(e => e.key))
        : undefined;
    this.store.saveQuery(queryDef as any, queryKey, data, updatedAt, refKeys);
  }

  activateQuery(queryInstance: QueryInstance<any>): void {
    const { def, queryKey, storageKey, config } = queryInstance;
    this.store.activateQuery(def as any, storageKey);

    const gcTime = config?.gcTime ?? DEFAULT_GC_TIME;
    this.gcManager.cancel(queryKey, gcTime);
  }

  loadCachedQuery(queryDef: QueryDefinition<QueryParams | undefined, unknown, unknown>, queryKey: number) {
    return this.store.loadQuery(queryDef as any, queryKey);
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
  ): ReactiveTask<Response, [Request]> {
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

  /**
   * Parse data: validates, formats, produces parsed entity data objects.
   * Does NOT touch the entity store. Call applyRefs() after to commit entities.
   */
  parseData(obj: unknown, shape: InternalTypeDef, preloadedEntities?: PreloadedEntityMap): ParseResult {
    const warn = this.context.log?.warn ?? (() => {});
    const ctx = new ParseContext();
    ctx.reset(this, preloadedEntities, warn);
    const data = parseEntities(obj, shape as unknown as ComplexTypeDef, ctx);
    return { data, ctx };
  }

  /**
   * Apply entities from parseData() via a single depth-first walk: creates/
   * updates EntityInstances, replaces parsed data with proxies, counts child
   * refs. Returns the reified data and root-level entity refs.
   */
  applyRefs(parseResult: ParseResult, persist: boolean = true, appendMode: boolean = false): ApplyResult {
    return applyEntityRefs(parseResult.ctx, parseResult.data, persist, appendMode);
  }

  /**
   * Parse and apply data as a root entity. For non-entity results, injects
   * QUERY_ID onto the payload. Returns the root EntityInstance (created or
   * found in the store by the standard entity pipeline).
   */
  parseAndApplyRootEntity(
    obj: unknown,
    queryId: number,
    rootEntityShape: ValidatorDef<any>,
    persist: boolean,
    appendMode: boolean = false,
    preloadedEntities?: PreloadedEntityMap,
  ): EntityInstance {
    // For non-entity results (QUERY_ID idField), inject the query id onto
    // fresh data payloads. Cached data arrives as { __entityRef } so
    // parseEntityData reads the key directly from that instead.
    if (
      typeof rootEntityShape.idField === 'symbol' &&
      typeof obj === 'object' &&
      obj !== null &&
      !('__entityRef' in (obj as Record<string, unknown>))
    ) {
      (obj as Record<string | symbol, unknown>)[QUERY_ID] = queryId;
    }

    const parseResult = this.parseData(obj, rootEntityShape as unknown as InternalTypeDef, preloadedEntities);
    const result = applyEntityRefs(parseResult.ctx, parseResult.data, persist, appendMode);

    // Discover the root entity from the returned proxy
    const proxyKey = PROXY_ID.get(result.data as object);
    return this.entityMap.getEntity(proxyKey!)!;
  }

  prepareEntity(key: number, obj: Record<string, unknown>, shape: EntityDef): EntityInstance {
    this.registerEntityDef(shape as unknown as ValidatorDef<any>);
    return this.entityMap.getOrCreateEntity(key, obj, shape, this);
  }

  // ======================================================
  // Mutation Events
  // ======================================================

  applyMutationEvent(event: MutationEvent): void {
    const { type, typename } = event;

    const mergedDef = this.getMergedDef(typename);
    if (mergedDef === undefined) return;

    const idField = mergedDef.idField;
    if (idField === undefined || typeof idField === 'symbol') return;

    const rawData = event.data;
    const id =
      event.id !== undefined
        ? event.id
        : type === 'delete' && (typeof rawData === 'string' || typeof rawData === 'number')
          ? rawData
          : (rawData as Record<string, unknown>)[idField];

    if (id === undefined) return;

    const key = hashValue([typename, id]);
    const eventSource = event.__eventSource;
    const data = (typeof rawData === 'object' && rawData !== null ? rawData : {}) as Record<string, unknown>;

    const existing = this.entityMap.getEntity(key);

    if (type === 'delete') {
      const entityData = existing !== undefined ? existing.data : data;
      this.routeEvent(typename, entityData, key, type, eventSource, undefined, entityData);
      return;
    }

    try {
      const warn = this.context.log?.warn ?? (() => {});
      const parseCtx = new ParseContext();
      parseCtx.reset(this, undefined, warn, /* isPartialEvent */ true);
      const parsedData = parseEntity(data, mergedDef as unknown as EntityDef, parseCtx);
      applyEntityRefs(parseCtx, parsedData, true);
    } catch (e) {
      this.context.log?.warn?.('Failed to apply mutation event', e);
      if (existing === undefined) {
        const created = this.entityMap.getEntity(key);
        if (created !== undefined) created.evict();
      }
      return;
    }

    const entity = this.entityMap.getEntity(key);
    if (entity === undefined) return;

    this.entityMap.save(entity);

    const wasNew = existing === undefined;
    let matched = false;

    this.routeEvent(typename, entity.data, key, type, eventSource, () => {
      matched = true;
    });

    if (wasNew && !matched) {
      entity.evict();
    }
  }

  // ======================================================
  // In-Memory GC
  // ======================================================

  private handleEviction = (key: number, type: GcKeyType): void => {
    if (type === GcKeyType.Query) {
      const instance = this.queryInstances.get(key);
      if (instance === undefined) return;
      instance.rootEntity?.evict();
      this.queryInstances.delete(key);
      return;
    }
    const entity = this.entityMap.getEntity(key);
    if (entity !== undefined) entity.evict();
  };

  // ======================================================
  // Constraint Registry (Live Collections)
  // ======================================================

  getOrCreateMatcher(typename: string): ConstraintMatcher {
    let matcher = this.constraintRegistry.get(typename);
    if (matcher === undefined) {
      matcher = new ConstraintMatcher();
      this.constraintRegistry.set(typename, matcher);
    }
    return matcher;
  }

  registerLiveCollection(binding: LiveCollectionBinding): void {
    for (const [typename, def] of binding._entityDefsByTypename) {
      this.registerEntityDef(def);
      this.getOrCreateMatcher(typename).registerBinding(binding, typename);
    }
  }

  unregisterLiveCollection(binding: LiveCollectionBinding): void {
    for (const typename of binding._entityDefsByTypename.keys()) {
      const matcher = this.constraintRegistry.get(typename);
      if (matcher !== undefined) {
        matcher.unregisterBinding(binding, typename);
      }
    }
  }

  private routeEvent(
    typename: string,
    entityData: Record<string, unknown>,
    entityKey: number,
    eventType: 'create' | 'update' | 'delete',
    eventSource: number | undefined,
    onMatch?: () => void,
    deleteData?: Record<string, unknown>,
  ): void {
    const matcher = this.constraintRegistry.get(typename);
    if (matcher === undefined) return;

    const data = eventSource !== undefined ? { ...entityData, [EVENT_SOURCE_FIELD]: eventSource } : entityData;
    matcher.routeEvent(typename, data, entityKey, eventType, onMatch, deleteData);
  }

  destroy(): void {
    this.gcManager.destroy();
    this.networkManager.destroy();
    this.queryInstances.clear();
    this.mutationInstances.clear();
    this.constraintRegistry.clear();
    this.typenameRegistry.clear();
    this.mergedDefCache.clear();
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);
