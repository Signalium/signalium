import { relay, DiscriminatedReactivePromise, Notifier, notifier } from 'signalium';
import { EntityDef } from './types.js';
import { createEntityProxy, mergeValues } from './proxy.js';
import type { QueryClient } from './QueryClient.js';
import { ValidatorDef } from './typeDefs.js';

/**
 * Deep clone an object, handling nested objects and arrays.
 * Used for snapshotting entity data before optimistic updates.
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => deepClone(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  // For plain objects, create a shallow copy and recursively clone values
  const cloned = {} as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    cloned[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return cloned as T;
}

export interface PreloadedEntityRecord {
  key: number;
  data: Record<string, unknown>;
  notifier: Notifier;
  cache: Map<PropertyKey, any>;
  id?: string | number;
  proxy?: Record<string, unknown>;
  entityRefs?: Set<number>;
}

export type EntityRecord = Required<PreloadedEntityRecord>;

/**
 * Tracks pending optimistic updates for an entity.
 * Includes the snapshot of original data for rollback.
 */
interface PendingOptimisticUpdate {
  snapshot: Record<string, unknown>; // Original data before optimistic update
}

export class EntityStore {
  private map = new Map<number, PreloadedEntityRecord | EntityRecord>();
  private queryClient: QueryClient;

  /**
   * Tracks pending optimistic updates by entity key.
   * Each entity can only have one pending update at a time (throws if concurrent).
   */
  private pendingOptimisticUpdates = new Map<number, PendingOptimisticUpdate>();

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  hasEntity(key: number): boolean {
    return this.map.has(key);
  }

  getEntity(key: number): PreloadedEntityRecord | EntityRecord | undefined {
    return this.map.get(key);
  }

  getNestedEntityRefIds(key: number, refIds: Set<number>): Set<number> {
    const record = this.getEntity(key);

    if (record === undefined) {
      throw new Error(`Entity ${key} not found when getting nested entity ref ids`);
    }

    refIds.add(key);

    // Entangle the signal value. Whenever the signal value is updated, refIds
    // will also be updated, so no need for a second signal.
    record.notifier.consume();

    if (record.entityRefs !== undefined) {
      for (const ref of record.entityRefs) {
        this.getNestedEntityRefIds(ref, refIds);
      }
    }

    return refIds;
  }

  hydratePreloadedEntity(key: number, shape: EntityDef): EntityRecord {
    const record = this.getEntity(key);
    if (record === undefined) {
      throw new Error(`Entity ${key} not found`);
    }

    record.proxy = this.createEntityProxy(record, shape);

    return record as EntityRecord;
  }

  setPreloadedEntity(key: number, data: Record<string, unknown>): PreloadedEntityRecord {
    const record: PreloadedEntityRecord = {
      key,
      data,
      notifier: notifier(),
      cache: new Map(),
      id: undefined,
      proxy: undefined,
      entityRefs: undefined,
    };

    this.map.set(key, record);

    return record;
  }

  setEntity(key: number, obj: Record<string, unknown>, shape: EntityDef, entityRefs?: Set<number>): EntityRecord {
    let record = this.map.get(key);

    if (record === undefined) {
      record = this.setPreloadedEntity(key, obj);

      record.proxy = this.createEntityProxy(record, shape);
    } else {
      record.data = mergeValues(record.data, obj);
      record.notifier.notify();
      record.cache.clear();

      // Create proxy if it doesn't exist (for preloaded entities from cache)
      if (record.proxy === undefined) {
        record.proxy = this.createEntityProxy(record, shape);
      }
    }

    record.entityRefs = entityRefs;

    return record as EntityRecord;
  }

  // ======================================================
  // Optimistic Update Tracking
  // ======================================================

  /**
   * Register a pending optimistic update for an entity.
   * Snapshots the current state and applies the optimistic update.
   *
   * @throws Error if the entity already has a pending optimistic update
   */
  registerOptimisticUpdate(entityKey: number, fields: Record<string, unknown>): void {
    // Throw if entity already has pending optimistic updates
    if (this.pendingOptimisticUpdates.has(entityKey)) {
      throw new Error(
        `Cannot apply optimistic update: entity ${entityKey} already has a pending optimistic update from another mutation.`,
      );
    }

    const record = this.map.get(entityKey);
    if (!record) {
      // Entity doesn't exist yet - nothing to snapshot, just track
      this.pendingOptimisticUpdates.set(entityKey, { snapshot: {} });
      return;
    }

    // Deep snapshot the current data BEFORE applying the update
    const snapshot = deepClone(record.data);

    // Store the pending update with snapshot
    this.pendingOptimisticUpdates.set(entityKey, { snapshot });

    // Apply the optimistic update to the entity
    record.data = mergeValues(record.data, fields);
    record.cache.clear();

    // Defer notification to avoid dirtying signal within reactive context
    queueMicrotask(() => {
      record.notifier.notify();
    });
  }

  /**
   * Revert the optimistic update for an entity, restoring its snapshot.
   * Called when a mutation fails.
   */
  revertOptimisticUpdate(entityKey: number): void {
    const pending = this.pendingOptimisticUpdates.get(entityKey);
    if (!pending) {
      return; // No pending update to revert
    }

    const record = this.map.get(entityKey);
    if (record && Object.keys(pending.snapshot).length > 0) {
      // Restore the snapshot
      record.data = pending.snapshot;
      record.cache.clear();

      // Defer notification to avoid dirtying signal within reactive context
      queueMicrotask(() => {
        record.notifier.notify();
      });
    }

    // Clear the pending update
    this.pendingOptimisticUpdates.delete(entityKey);
  }

  /**
   * Clear the optimistic update for an entity without reverting.
   * Called when a mutation succeeds (the optimistic update is now confirmed).
   */
  clearOptimisticUpdates(entityKey: number): void {
    this.pendingOptimisticUpdates.delete(entityKey);
  }

  private createEntityProxy(record: PreloadedEntityRecord, shape: EntityDef): Record<string, unknown> {
    const idField = shape.idField;
    if (idField === undefined) {
      throw new Error(`Entity id field is required ${shape.typenameValue}`);
    }

    const id = record.data[idField];

    if (typeof id !== 'string' && typeof id !== 'number') {
      console.log(record.data);
      throw new Error(`Entity id must be string or number: ${shape.typenameValue}`);
    }

    record.id = id;

    let entityRelay: DiscriminatedReactivePromise<Record<string, unknown>> | undefined;
    const entityConfig = (shape as unknown as ValidatorDef<unknown>)._entityConfig;

    if (entityConfig?.stream) {
      entityRelay = relay(state => {
        const context = this.queryClient.getContext();
        const onUpdate = (update: Partial<Record<string, unknown>>) => {
          const currentValue = record.data;
          const merged = mergeValues(currentValue, update);
          record.data = merged;
          record.notifier.notify();
          record.cache.clear();
        };

        const unsubscribe = entityConfig.stream.subscribe(context, id as string | number, onUpdate as any);

        // Set initial value to the proxy - this resolves the relay promise
        // Proxy should always exist at this point since it's created before relay access
        state.value = record.proxy!;

        return unsubscribe;
      });
    }

    const warn = this.queryClient.getContext().log?.warn;
    return createEntityProxy(record.key, record, shape, entityRelay, this.queryClient, warn);
  }
}
