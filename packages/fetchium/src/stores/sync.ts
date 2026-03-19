import { CachedQuery, QueryStore, type PreloadedEntityMap } from '../QueryClient.js';
import { QueryDefinition } from '../query.js';
import {
  cacheTimeKeyFor,
  DEFAULT_CACHE_TIME,
  DEFAULT_MAX_COUNT,
  LAST_USED_PREFIX,
  lastUsedKeyFor,
  queueKeyFor,
  refCountKeyFor,
  refIdsKeyFor,
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

  getAllKeys(): string[];
}

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

  getAllKeys(): string[] {
    return Object.keys(this.kv);
  }
}

export class SyncQueryStore implements QueryStore {
  queues: Map<string, Uint32Array> = new Map();

  constructor(private readonly kv: SyncPersistentStore) {}

  loadQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): CachedQuery | undefined {
    const updatedAt = this.kv.getNumber(updatedAtKeyFor(queryKey));

    const cacheTimeMs = (queryDef.statics.cache?.cacheTime ?? DEFAULT_CACHE_TIME) * 60 * 1000;
    if (updatedAt === undefined || updatedAt < Date.now() - cacheTimeMs) {
      return;
    }

    const valueStr = this.kv.getString(valueKeyFor(queryKey));

    if (valueStr === undefined) {
      return;
    }

    const entityIds = this.kv.getBuffer(refIdsKeyFor(queryKey));

    let preloadedEntities: PreloadedEntityMap | undefined;
    if (entityIds !== undefined) {
      preloadedEntities = new Map();
      this.preloadEntities(entityIds, preloadedEntities);
    }

    this.activateQuery(queryDef, queryKey);

    return {
      value: JSON.parse(valueStr) as Record<string, unknown>,
      refIds: entityIds === undefined ? undefined : new Set(entityIds ?? []),
      updatedAt,
      preloadedEntities,
    };
  }

  private preloadEntities(entityIds: Uint32Array, preloaded: PreloadedEntityMap): void {
    for (const entityId of entityIds) {
      const entityValue = this.kv.getString(valueKeyFor(entityId));

      if (entityValue === undefined) {
        continue;
      }

      preloaded.set(entityId, JSON.parse(entityValue) as Record<string, unknown>);

      const childIds = this.kv.getBuffer(refIdsKeyFor(entityId));

      if (childIds === undefined) {
        continue;
      }

      this.preloadEntities(childIds, preloaded);
    }
  }

  saveQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: Set<number>,
  ): void {
    this.setValue(queryKey, value, refIds);
    this.kv.setNumber(updatedAtKeyFor(queryKey), updatedAt);
    this.activateQuery(queryDef, queryKey);
  }

  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void {
    this.setValue(entityKey, value, refIds);
  }

  activateQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): void {
    if (!this.kv.has(valueKeyFor(queryKey))) {
      return;
    }

    const queryDefId = queryDef.statics.id;
    let queue = this.queues.get(queryDefId);

    if (queue === undefined) {
      const maxCount = queryDef.statics.cache?.maxCount ?? DEFAULT_MAX_COUNT;
      queue = this.kv.getBuffer(queueKeyFor(queryDefId));

      if (queue === undefined) {
        queue = new Uint32Array(maxCount);
        this.kv.setBuffer(queueKeyFor(queryDefId), queue);
      } else if (queue.length !== maxCount) {
        queue = new Uint32Array(queue.buffer, 0, maxCount);
        this.kv.setBuffer(queueKeyFor(queryDefId), queue);
      }

      this.queues.set(queryDefId, queue);
    }

    this.kv.setNumber(lastUsedKeyFor(queryDefId), Date.now());
    this.kv.setNumber(cacheTimeKeyFor(queryDefId), queryDef.statics.cache?.cacheTime ?? DEFAULT_CACHE_TIME);

    const indexOfKey = queue.indexOf(queryKey);

    if (indexOfKey >= 0) {
      if (indexOfKey === 0) {
        return;
      }
      queue.copyWithin(1, 0, indexOfKey);
      queue[0] = queryKey;
      return;
    }

    const evicted = queue[queue.length - 1];
    queue.copyWithin(1, 0, queue.length - 1);
    queue[0] = queryKey;

    if (evicted !== 0) {
      this.deleteQuery(evicted);
      this.kv.delete(updatedAtKeyFor(evicted));
    }
  }

  purgeStaleQueries(): void {
    const allKeys = this.kv.getAllKeys();
    const now = Date.now();

    for (const key of allKeys) {
      if (!key.startsWith(LAST_USED_PREFIX)) continue;

      const queryDefId = key.slice(LAST_USED_PREFIX.length);
      const lastUsedAt = this.kv.getNumber(key);
      const cacheTime = this.kv.getNumber(cacheTimeKeyFor(queryDefId)) ?? DEFAULT_CACHE_TIME;
      const cacheTimeMs = cacheTime * 60 * 1000;

      if (lastUsedAt === undefined || now - lastUsedAt > cacheTimeMs) {
        const queue = this.kv.getBuffer(queueKeyFor(queryDefId));

        if (queue !== undefined) {
          for (const queryKey of queue) {
            if (queryKey !== 0) {
              this.deleteQuery(queryKey);
              this.kv.delete(updatedAtKeyFor(queryKey));
            }
          }
        }

        this.kv.delete(queueKeyFor(queryDefId));
        this.kv.delete(key);
        this.kv.delete(cacheTimeKeyFor(queryDefId));
        this.queues.delete(queryDefId);
      }
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
