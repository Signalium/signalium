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

import {
  relay,
  type RelayState,
  context,
  DiscriminatedReactivePromise,
  type Context,
  notifier,
  Notifier,
  Signal,
} from 'signalium';
import { hashValue, setReactivePromise } from 'signalium/utils';
import { DiscriminatedQueryResult, EntityDef, QueryResult, ObjectFieldTypeDef, ComplexTypeDef } from './types.js';
import { parseValue } from './proxy.js';
import { parseEntities } from './parseEntities.js';
import { EntityRecord, EntityStore } from './EntityMap.js';
import { QueryStore } from './QueryStore.js';
import { ValidatorDef } from './typeDefs.js';

export interface QueryContext {
  fetch: typeof fetch;
}

export interface QueryCacheOptions {
  maxCount?: number;
  maxAge?: number; // milliseconds
}

export interface QueryDefinition<Params, Result> {
  id: string;
  shape: ObjectFieldTypeDef;
  fetchFn: (context: QueryContext, params: Params) => Promise<Result>;

  staleTime?: number;
  refetchInterval?: number;

  cache?: QueryCacheOptions;
}

interface QueryInstance<T> {
  relay: QueryResultImpl<T>;
  initialized: boolean;
  notifier: Notifier;
}

const queryKeyFor = (queryDef: QueryDefinition<any, any>, params: unknown): number => {
  return hashValue([queryDef.id, params]);
};

/**
 * QueryResult wraps a DiscriminatedReactivePromise and adds additional functionality
 * like refetch, while forwarding all the base relay properties.
 */
export class QueryResultImpl<T> implements QueryResult<T> {
  constructor(
    private relay: DiscriminatedReactivePromise<T>,
    private instance: QueryInstance<T>,
  ) {
    setReactivePromise(this);
  }

  // Forward all ReactivePromise properties through getters
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
  private get _version(): Promise<T> {
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

  // Additional methods
  refetch(): Promise<T> {
    this.instance.notifier.notify();
    // pull the value to make sure the relay is activated
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.instance.relay.value;
    return this.relay;
  }

  // Make it work with Symbol.toStringTag for Promise detection
  get [Symbol.toStringTag](): string {
    return 'QueryResult';
  }
}

export class QueryClient {
  private entityMap = new EntityStore();
  private queryInstances = new Map<number, QueryInstance<unknown>>();

  constructor(
    private store: QueryStore,
    private context: QueryContext = { fetch },
  ) {}

  /**
   * Loads a query from the document store and returns a QueryResult
   * that triggers fetches and prepopulates with cached data
   */
  getQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    params: Params,
  ): DiscriminatedQueryResult<Result> {
    const queryKey = queryKeyFor(queryDef, params);

    let queryInstance = this.queryInstances.get(queryKey);

    // Create a new relay if it doesn't exist
    if (queryInstance === undefined) {
      queryInstance = {
        relay: undefined as any,
        initialized: false,
        notifier: notifier(),
      };

      const queryRelay = relay<Result>(state => {
        // Load from cache first, then fetch fresh data
        queryInstance!.notifier.consume();

        this.store.activateQuery(queryDef, queryKey);

        if (queryInstance!.initialized) {
          state.setPromise(this.runQuery(queryDef, queryKey, params));
        } else {
          this.initializeQuery(queryDef, params, state as RelayState<unknown>, queryInstance as QueryInstance<Result>);
        }
      });

      queryInstance.relay = new QueryResultImpl(queryRelay as DiscriminatedReactivePromise<Result>, queryInstance);

      // Store the relay for future use
      this.queryInstances.set(queryKey, queryInstance);
    }

    return queryInstance.relay as DiscriminatedQueryResult<Result>;
  }

  private async initializeQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    params: Params,
    state: RelayState<unknown>,
    instance: QueryInstance<Result>,
  ): Promise<void> {
    try {
      instance.initialized = true;
      const queryKey = queryKeyFor(queryDef, params);
      // Load from cache first
      const query = this.store.loadQuery(queryDef, queryKey, this.entityMap);

      if (query !== undefined) {
        const shape = queryDef.shape;
        state.value =
          shape instanceof ValidatorDef
            ? parseEntities(query, shape as ComplexTypeDef, this, new Set())
            : parseValue(query, shape, queryDef.id);
      }

      state.setPromise(this.runQuery(queryDef, queryKey, params));
    } catch (error) {
      // Relay will handle the error state automatically
      state.setError(error as Error);
    }
  }

  /**
   * Fetches fresh data and updates the cache
   */
  private async runQuery<Params, Result>(
    queryDef: QueryDefinition<Params, Result>,
    queryKey: number,
    params: Params,
  ): Promise<Result> {
    const freshData = await queryDef.fetchFn(this.context, params);
    // Parse and cache the fresh data
    const entityRefs = new Set<number>();

    const shape = queryDef.shape;

    const parsedData =
      shape instanceof ValidatorDef
        ? parseEntities(freshData, shape as ComplexTypeDef, this, entityRefs)
        : parseValue(freshData, shape, queryDef.id);

    // Cache the data (synchronous, fire-and-forget)
    this.store.saveQuery(queryDef, queryKey, freshData, entityRefs);

    return parsedData as Result;
  }

  hydrateEntity(key: number, shape: EntityDef): EntityRecord {
    return this.entityMap.hydratePreloadedEntity(key, shape);
  }

  saveEntity(key: number, obj: Record<string, unknown>, shape: EntityDef, entityRefs?: Set<number>): EntityRecord {
    const record = this.entityMap.setEntity(key, obj, shape);

    this.store.saveEntity(key, obj, entityRefs);

    return record;
  }
}

export const QueryClientContext: Context<QueryClient | undefined> = context<QueryClient | undefined>(undefined);
