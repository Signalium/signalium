import { EntityStore } from '../EntityMap.js';
import { CachedQuery, CachedQueryExtra, QueryDefinition, QueryStore } from '../QueryClient.js';
import {
  optimisticInsertRefsKeyFor,
  refCountKeyFor,
  refIdsKeyFor,
  streamOrphanRefsKeyFor,
  updatedAtKeyFor,
  valueKeyFor,
} from './shared.js';

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
const DEFAULT_GC_TIME = 1000 * 60 * 60 * 24; // 24 hours

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

// Query Type keys
export const queueKeyFor = (queryDefId: string) => `sq:doc:queue:${queryDefId}`;

export class SyncQueryStore implements QueryStore {
  queues: Map<string, Uint32Array> = new Map();

  constructor(private readonly kv: SyncPersistentStore) {}

  loadQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): CachedQuery | undefined {
    const updatedAt = this.kv.getNumber(updatedAtKeyFor(queryKey));

    if (updatedAt === undefined || updatedAt < Date.now() - (queryDef.cache?.gcTime ?? DEFAULT_GC_TIME)) {
      return;
    }

    const valueStr = this.kv.getString(valueKeyFor(queryKey));

    if (valueStr === undefined) {
      return;
    }

    const entityIds = this.kv.getBuffer(refIdsKeyFor(queryKey));

    if (entityIds !== undefined) {
      this.preloadEntities(entityIds, entityMap);
    }

    // Load extra data (stream orphans and optimistic inserts)
    const streamOrphanRefs = this.kv.getBuffer(streamOrphanRefsKeyFor(queryKey));
    const optimisticInsertRefs = this.kv.getBuffer(optimisticInsertRefsKeyFor(queryKey));

    // Preload entities for extra data
    if (streamOrphanRefs !== undefined) {
      this.preloadEntities(streamOrphanRefs, entityMap);
    }
    if (optimisticInsertRefs !== undefined) {
      this.preloadEntities(optimisticInsertRefs, entityMap);
    }

    let extra: CachedQueryExtra | undefined;
    if (streamOrphanRefs !== undefined || optimisticInsertRefs !== undefined) {
      extra = {};
      if (streamOrphanRefs !== undefined) {
        extra.streamOrphanRefs = Array.from(streamOrphanRefs);
      }
      if (optimisticInsertRefs !== undefined) {
        extra.optimisticInsertRefs = Array.from(optimisticInsertRefs);
      }
    }

    this.activateQuery(queryDef, queryKey);

    return {
      value: JSON.parse(valueStr) as Record<string, unknown>,
      refIds: entityIds === undefined ? undefined : new Set(entityIds ?? []),
      updatedAt,
      extra,
    };
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

  saveQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: Set<number>,
    extra?: CachedQueryExtra,
  ): void {
    this.setValue(queryKey, value, refIds);
    this.kv.setNumber(updatedAtKeyFor(queryKey), updatedAt);

    // Save extra data
    if (extra?.streamOrphanRefs !== undefined && extra.streamOrphanRefs.length > 0) {
      this.kv.setBuffer(streamOrphanRefsKeyFor(queryKey), new Uint32Array(extra.streamOrphanRefs));
    } else {
      this.kv.delete(streamOrphanRefsKeyFor(queryKey));
    }

    if (extra?.optimisticInsertRefs !== undefined && extra.optimisticInsertRefs.length > 0) {
      this.kv.setBuffer(optimisticInsertRefsKeyFor(queryKey), new Uint32Array(extra.optimisticInsertRefs));
    } else {
      this.kv.delete(optimisticInsertRefsKeyFor(queryKey));
    }

    this.activateQuery(queryDef, queryKey);
  }

  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void {
    this.setValue(entityKey, value, refIds);
  }

  activateQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): void {
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
        queue = new Uint32Array(queue.buffer, 0, maxCount);
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
      this.deleteQuery(evicted);
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
      // NOTE: Using spread operator because Hermes (React Native) doesn't correctly
      // handle new Uint32Array(Set) - it produces an empty array instead of converting
      const newRefIds = new Uint32Array([...refIds]);

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

  deleteQuery(id: number): void {
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
      this.deleteQuery(refId);
    } else {
      this.kv.setNumber(refCountKey, newCount);
    }
  }
}
