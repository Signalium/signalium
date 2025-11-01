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

export interface QueryStore {
  /**
   * Asynchronously retrieves a document by key.
   * May return undefined if the document is not in the store.
   */
  loadQuery(
    queryDef: QueryDefinition<any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): MaybePromise<unknown | undefined>;

  /**
   * Synchronously stores a document with optional reference IDs.
   * This is fire-and-forget for async implementations.
   */
  saveQuery(queryDef: QueryDefinition<any, any>, queryKey: number, value: unknown, refIds?: Set<number>): void;

  /**
   * Synchronously stores an entity with optional reference IDs.
   * This is fire-and-forget for async implementations.
   */
  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void;

  /**
   * Marks a query as accessed, updating the LRU queue.
   * Handles eviction internally when the cache is full.
   */
  activateQuery(queryDef: QueryDefinition<any, any>, queryKey: number): void;
}

export type MaybePromise<T> = T | Promise<T>;

export interface SyncPersistentStore {
  has(key: string): boolean;

  getString(key: string): string | undefined;
  setString(key: string, value: string): void;

  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;

  getBuffer(key: string): Uint32Array | undefined;
  setBuffer(key: string, value: Uint32Array): void;

  delete(key: string): void;
}

const DEFAULT_MAX_COUNT = 50;
const DEFAULT_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours

export class MemoryPersistentStore implements SyncPersistentStore {
  private readonly kv: Record<string, unknown> = Object.create(null);

  has(key: string): boolean {
    return key in this.kv;
  }

  getString(key: string): string | undefined {
    return this.kv[key] as string | undefined;
  }

  setString(key: string, value: string): void {
    this.kv[key] = value;
  }

  getNumber(key: string): number | undefined {
    return this.kv[key] as number | undefined;
  }

  setNumber(key: string, value: number): void {
    this.kv[key] = value;
  }

  getBuffer(key: string): Uint32Array | undefined {
    return this.kv[key] as Uint32Array | undefined;
  }

  setBuffer(key: string, value: Uint32Array): void {
    this.kv[key] = value;
  }

  delete(key: string): void {
    delete this.kv[key];
  }
}

// Query Instance keys
export const valueKeyFor = (id: number) => `sq:doc:value:${id}`;
export const refCountKeyFor = (id: number) => `sq:doc:refCount:${id}`;
export const refIdsKeyFor = (id: number) => `sq:doc:refIds:${id}`;
export const updatedAtKeyFor = (id: number) => `sq:doc:updatedAt:${id}`;

// Query Type keys
export const queueKeyFor = (queryDefId: string) => `sq:doc:queue:${queryDefId}`;

export class SyncQueryStore implements QueryStore {
  queues: Map<string, Uint32Array> = new Map();

  constructor(private readonly kv: SyncPersistentStore) {}

  loadQuery(queryDef: QueryDefinition<any, any>, queryKey: number, entityMap: EntityStore): unknown | undefined {
    const updatedAt = this.kv.getNumber(updatedAtKeyFor(queryKey));

    if (updatedAt === undefined || updatedAt < Date.now() - (queryDef.cache?.maxAge ?? DEFAULT_MAX_AGE)) {
      return;
    }

    const value = this.kv.getString(valueKeyFor(queryKey));

    if (value === undefined) {
      return;
    }

    const entityIds = this.kv.getBuffer(refIdsKeyFor(queryKey));

    if (entityIds !== undefined) {
      this.preloadEntities(entityIds, entityMap);
    }

    this.activateQuery(queryDef, queryKey);

    return JSON.parse(value) as Record<string, unknown>;
  }

  private preloadEntities(entityIds: Uint32Array, entityMap: EntityStore): void {
    for (const entityId of entityIds) {
      const entityValue = this.kv.getString(valueKeyFor(entityId));

      if (entityValue === undefined) {
        continue;
      }

      const entity = JSON.parse(entityValue) as Record<string, unknown>;
      entityMap.setPreloadedEntity(entityId, entity);

      const childIds = this.kv.getBuffer(refIdsKeyFor(entityId));

      if (childIds === undefined) {
        continue;
      }

      this.preloadEntities(childIds, entityMap);
    }
  }

  saveQuery(queryDef: QueryDefinition<any, any>, queryKey: number, value: unknown, refIds?: Set<number>): void {
    this.setValue(queryKey, value, refIds);
    this.kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
    this.activateQuery(queryDef, queryKey);
  }

  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void {
    this.setValue(entityKey, value, refIds);
  }

  activateQuery(queryDef: QueryDefinition<any, any>, queryKey: number): void {
    if (!this.kv.has(valueKeyFor(queryKey))) {
      // Query not in store, nothing to do. This can happen if the query has
      // been evicted from the cache, but is still active in memory.
      return;
    }

    let queue = this.queues.get(queryDef.id);

    if (queue === undefined) {
      const maxCount = queryDef.cache?.maxCount ?? DEFAULT_MAX_COUNT;
      queue = this.kv.getBuffer(queueKeyFor(queryDef.id));

      if (queue === undefined) {
        queue = new Uint32Array(maxCount);
        this.kv.setBuffer(queueKeyFor(queryDef.id), queue);
      } else if (queue.length !== maxCount) {
        const newQueue = new Uint32Array(maxCount);
        newQueue.set(queue);
        queue = newQueue;
        this.kv.setBuffer(queueKeyFor(queryDef.id), queue);
      }

      this.queues.set(queryDef.id, queue);
    }

    const indexOfKey = queue.indexOf(queryKey);

    // Item already in queue, move to front
    if (indexOfKey >= 0) {
      if (indexOfKey === 0) {
        // Already at front, nothing to do
        return;
      }
      // Shift items right to make space at front
      queue.copyWithin(1, 0, indexOfKey);
      queue[0] = queryKey;
      return;
    }

    // Item not in queue, add to front and evict tail
    const evicted = queue[queue.length - 1];
    queue.copyWithin(1, 0, queue.length - 1);
    queue[0] = queryKey;

    if (evicted !== 0) {
      this.deleteValue(evicted);
      this.kv.delete(updatedAtKeyFor(evicted));
    }
  }

  private setValue(id: number, value: unknown, refIds?: Set<number>): void {
    const kv = this.kv;

    kv.setString(valueKeyFor(id), JSON.stringify(value));

    const refIdsKey = refIdsKeyFor(id);

    const prevRefIds = kv.getBuffer(refIdsKey);

    if (refIds === undefined || refIds.size === 0) {
      kv.delete(refIdsKey);

      // Decrement all previous refs
      if (prevRefIds !== undefined) {
        for (let i = 0; i < prevRefIds.length; i++) {
          const refId = prevRefIds[i];
          this.decrementRefCount(refId);
        }
      }
    } else {
      // Convert the set to a Uint32Array and capture all the refIds before we
      // delete previous ones from the set
      const newRefIds = new Uint32Array(refIds);

      if (prevRefIds !== undefined) {
        // Process new refs: increment if not in old
        for (let i = 0; i < prevRefIds.length; i++) {
          const refId = prevRefIds[i];

          if (refIds.has(refId)) {
            refIds.delete(refId);
          } else {
            this.decrementRefCount(refId);
          }
        }
      }

      // No previous refs, increment all unique new refs
      for (const refId of refIds) {
        this.incrementRefCount(refId);
      }

      kv.setBuffer(refIdsKey, newRefIds);
    }
  }

  private deleteValue(id: number): void {
    const kv = this.kv;

    kv.delete(valueKeyFor(id));
    kv.delete(refCountKeyFor(id));

    const refIds = kv.getBuffer(refIdsKeyFor(id));
    kv.delete(refIdsKeyFor(id)); // Clean up the refIds key

    if (refIds === undefined) {
      return;
    }

    // Decrement ref counts for all referenced entities
    for (const refId of refIds) {
      if (refId !== 0) {
        this.decrementRefCount(refId);
      }
    }
  }

  private incrementRefCount(refId: number): void {
    const refCountKey = refCountKeyFor(refId);
    const currentCount = this.kv.getNumber(refCountKey) ?? 0;
    const newCount = currentCount + 1;
    this.kv.setNumber(refCountKey, newCount);
  }

  private decrementRefCount(refId: number): void {
    const refCountKey = refCountKeyFor(refId);
    const currentCount = this.kv.getNumber(refCountKey);

    if (currentCount === undefined) {
      // Already deleted or never existed
      return;
    }

    const newCount = currentCount - 1;

    if (newCount === 0) {
      // Entity exists, cascade delete it
      this.deleteValue(refId);
    } else {
      this.kv.setNumber(refCountKey, newCount);
    }
  }
}
