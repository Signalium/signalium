/**
 * QueryStore - Minimal interface for query persistence
 *
 * Provides a clean abstraction over document storage, reference counting,
 * and LRU cache management. Supports both synchronous (in-memory) and
 * asynchronous (writer-backed) implementations.
 */

import { EntityStore } from './EntityMap.js';
import { QueryDefinition } from './QueryClient.js';

// -----------------------------------------------------------------------------
// QueryStore Interface
// -----------------------------------------------------------------------------

export interface CachedQueryExtra {
  streamOrphanRefs?: number[];
  optimisticInsertRefs?: number[];
}

export interface CachedQuery {
  value: unknown;
  refIds: Set<number> | undefined;
  updatedAt: number;
  extra?: CachedQueryExtra;
}

export interface QueryStore {
  /**
   * Asynchronously retrieves a document by key.
   * May return undefined if the document is not in the store.
   */
  loadQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): MaybePromise<CachedQuery | undefined>;

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
    extra?: CachedQueryExtra,
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
}

export type MaybePromise<T> = T | Promise<T>;
