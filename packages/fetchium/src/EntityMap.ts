import { EntityDef } from './types.js';
import type { QueryClient } from './QueryClient.js';
import { EntityInstance } from './EntityInstance.js';

export class EntityStore {
  private instances = new Map<number, EntityInstance>();
  private queryClient: QueryClient;

  /**
   * In-memory reference counts for entities. Tracks how many queries (and
   * parent entities) reference a given entity key. When the count reaches 0
   * the entity is eligible for GC.
   */
  private refCounts = new Map<number, number>();

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  hasEntity(key: number): boolean {
    return this.instances.has(key);
  }

  getEntity(key: number): EntityInstance | undefined {
    return this.instances.get(key);
  }

  getOrCreateEntity(key: number, data: Record<string, unknown>, shape: EntityDef): EntityInstance {
    let instance = this.instances.get(key);

    if (instance === undefined) {
      instance = new EntityInstance(key, data, shape, this.queryClient);
      this.instances.set(key, instance);
    } else {
      instance.update(data);
    }

    instance.parseId = this.queryClient.currentParseId;

    return instance;
  }

  // ======================================================
  // In-Memory Reference Counting
  // ======================================================

  incrementRefCount(entityKey: number): void {
    const current = this.refCounts.get(entityKey) ?? 0;
    this.refCounts.set(entityKey, current + 1);
  }

  /**
   * Decrement the ref count for an entity. Returns `true` if the count
   * reached zero (caller should schedule or immediately evict the entity).
   */
  decrementRefCount(entityKey: number): boolean {
    const current = this.refCounts.get(entityKey);
    if (current === undefined) return false;

    const next = current - 1;
    if (next <= 0) {
      this.refCounts.delete(entityKey);
      return true;
    }

    this.refCounts.set(entityKey, next);
    return false;
  }

  getRefCount(entityKey: number): number {
    return this.refCounts.get(entityKey) ?? 0;
  }

  /**
   * Remove an entity from the in-memory store. Returns the entity's child
   * `entityRefs` so the caller can cascade decrements.
   */
  removeEntity(key: number): Set<number> | undefined {
    const instance = this.instances.get(key);
    if (!instance) return undefined;

    const childRefs = instance.entityRefs;
    this.instances.delete(key);
    this.refCounts.delete(key);
    return childRefs;
  }
}
