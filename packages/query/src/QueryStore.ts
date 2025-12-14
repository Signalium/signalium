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

// -----------------------------------------------------------------------------
// Async QueryStore Interfaces
// -----------------------------------------------------------------------------

export interface AsyncPersistentStore {
  has(key: string): Promise<boolean>;

  getString(key: string): Promise<string | undefined>;
  setString(key: string, value: string): Promise<void>;

  getNumber(key: string): Promise<number | undefined>;
  setNumber(key: string, value: number): Promise<void>;

  getBuffer(key: string): Promise<Uint32Array | undefined>;
  setBuffer(key: string, value: Uint32Array): Promise<void>;

  delete(key: string): Promise<void>;
}

export type StoreMessage =
  | {
      type: 'saveQuery';
      queryDefId: string;
      queryKey: number;
      value: unknown;
      updatedAt: number;
      refIds?: number[];
      extra?: CachedQueryExtra;
    }
  | { type: 'saveEntity'; entityKey: number; value: unknown; refIds?: number[] }
  | { type: 'activateQuery'; queryDefId: string; queryKey: number };

export interface AsyncQueryStoreConfig {
  isWriter: boolean;
  connect: (handleMessage: (msg: StoreMessage) => void) => {
    sendMessage: (msg: StoreMessage) => void;
  };
  delegate?: AsyncPersistentStore; // Only provided for writer
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

// Query Instance keys
export const valueKeyFor = (id: number) => `sq:doc:value:${id}`;
export const refCountKeyFor = (id: number) => `sq:doc:refCount:${id}`;
export const refIdsKeyFor = (id: number) => `sq:doc:refIds:${id}`;
export const updatedAtKeyFor = (id: number) => `sq:doc:updatedAt:${id}`;
export const streamOrphanRefsKeyFor = (id: number) => `sq:doc:streamOrphanRefs:${id}`;
export const optimisticInsertRefsKeyFor = (id: number) => `sq:doc:optimisticInsertRefs:${id}`;

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

// -----------------------------------------------------------------------------
// Async QueryStore Implementation
// -----------------------------------------------------------------------------

export class AsyncQueryStore implements QueryStore {
  private readonly isWriter: boolean;
  private readonly delegate?: AsyncPersistentStore;
  private readonly sendMessage: (msg: StoreMessage) => void;
  private readonly messageQueue: StoreMessage[] = [];
  private readonly queues: Map<string, Uint32Array> = new Map();
  private queueProcessorPromise?: Promise<void>;
  private resolveQueueWait?: () => void;

  constructor(config: AsyncQueryStoreConfig) {
    this.isWriter = config.isWriter;
    this.delegate = config.delegate;

    // Connect and get sendMessage function
    const { sendMessage } = config.connect(this.handleMessage.bind(this));
    this.sendMessage = sendMessage;

    // Start queue processor if this is a writer
    if (this.isWriter) {
      if (!this.delegate) {
        throw new Error('Writer must have a delegate');
      }
      this.startQueueProcessor();
    }
  }

  private handleMessage(msg: StoreMessage): void {
    if (this.isWriter) {
      // Enqueue the message for serial processing
      this.enqueueMessage(msg);
    }
    // Readers don't handle incoming messages
  }

  private enqueueMessage(msg: StoreMessage): void {
    this.messageQueue.push(msg);
    // Wake up the queue processor if it's waiting
    if (this.resolveQueueWait) {
      this.resolveQueueWait();
      this.resolveQueueWait = undefined;
    }
  }

  private startQueueProcessor(): void {
    this.queueProcessorPromise = this.processQueue();
  }

  private async processQueue(): Promise<void> {
    while (true) {
      // Wait for messages if queue is empty
      while (this.messageQueue.length === 0) {
        await new Promise<void>(resolve => {
          this.resolveQueueWait = resolve;
        });
      }

      // Process one message at a time
      const msg = this.messageQueue.shift()!;

      try {
        await this.processMessage(msg);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }
  }

  private async processMessage(msg: StoreMessage): Promise<void> {
    switch (msg.type) {
      case 'saveQuery':
        await this.writerSaveQuery(msg.queryDefId, msg.queryKey, msg.value, msg.updatedAt, msg.refIds, msg.extra);
        break;
      case 'saveEntity':
        await this.writerSaveEntity(msg.entityKey, msg.value, msg.refIds);
        break;
      case 'activateQuery':
        await this.writerActivateQuery(msg.queryDefId, msg.queryKey);
        break;
    }
  }

  async loadQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    entityMap: EntityStore,
  ): Promise<CachedQuery | undefined> {
    if (!this.delegate) {
      return undefined;
    }

    const updatedAt = await this.delegate.getNumber(updatedAtKeyFor(queryKey));

    if (updatedAt === undefined || updatedAt < Date.now() - (queryDef.cache?.gcTime ?? DEFAULT_GC_TIME)) {
      return undefined;
    }

    const valueStr = await this.delegate.getString(valueKeyFor(queryKey));

    if (valueStr === undefined) {
      return undefined;
    }

    const entityIds = await this.delegate.getBuffer(refIdsKeyFor(queryKey));

    if (entityIds !== undefined) {
      await this.preloadEntities(entityIds, entityMap);
    }

    // Load extra data (stream orphans and optimistic inserts)
    const streamOrphanRefs = await this.delegate.getBuffer(streamOrphanRefsKeyFor(queryKey));
    const optimisticInsertRefs = await this.delegate.getBuffer(optimisticInsertRefsKeyFor(queryKey));

    // Preload entities for extra data
    if (streamOrphanRefs !== undefined) {
      await this.preloadEntities(streamOrphanRefs, entityMap);
    }
    if (optimisticInsertRefs !== undefined) {
      await this.preloadEntities(optimisticInsertRefs, entityMap);
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

  private async preloadEntities(entityIds: Uint32Array, entityMap: EntityStore): Promise<void> {
    if (!this.delegate) {
      return;
    }

    for (const entityId of entityIds) {
      const entityValue = await this.delegate.getString(valueKeyFor(entityId));

      if (entityValue === undefined) {
        continue;
      }

      const entity = JSON.parse(entityValue) as Record<string, unknown>;
      entityMap.setPreloadedEntity(entityId, entity);

      const childIds = await this.delegate.getBuffer(refIdsKeyFor(entityId));

      if (childIds === undefined) {
        continue;
      }

      await this.preloadEntities(childIds, entityMap);
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
    const message: StoreMessage = {
      type: 'saveQuery',
      queryDefId: queryDef.id,
      queryKey,
      value,
      updatedAt,
      refIds: refIds ? Array.from(refIds) : undefined,
      extra,
    };

    if (this.isWriter) {
      this.enqueueMessage(message);
    } else {
      this.sendMessage(message);
    }
  }

  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void {
    const message: StoreMessage = {
      type: 'saveEntity',
      entityKey,
      value,
      refIds: refIds ? Array.from(refIds) : undefined,
    };

    if (this.isWriter) {
      this.enqueueMessage(message);
    } else {
      this.sendMessage(message);
    }
  }

  activateQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): void {
    const message: StoreMessage = {
      type: 'activateQuery',
      queryDefId: queryDef.id,
      queryKey,
    };

    if (this.isWriter) {
      this.enqueueMessage(message);
    } else {
      this.sendMessage(message);
    }
  }

  // Writer-specific methods below

  private async writerSaveQuery(
    queryDefId: string,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: number[],
    extra?: CachedQueryExtra,
  ): Promise<void> {
    await this.setValue(queryKey, value, refIds ? new Set(refIds) : undefined);
    await this.delegate!.setNumber(updatedAtKeyFor(queryKey), updatedAt);

    // Save extra data
    if (extra?.streamOrphanRefs !== undefined && extra.streamOrphanRefs.length > 0) {
      await this.delegate!.setBuffer(streamOrphanRefsKeyFor(queryKey), new Uint32Array(extra.streamOrphanRefs));
    } else {
      await this.delegate!.delete(streamOrphanRefsKeyFor(queryKey));
    }

    if (extra?.optimisticInsertRefs !== undefined && extra.optimisticInsertRefs.length > 0) {
      await this.delegate!.setBuffer(optimisticInsertRefsKeyFor(queryKey), new Uint32Array(extra.optimisticInsertRefs));
    } else {
      await this.delegate!.delete(optimisticInsertRefsKeyFor(queryKey));
    }

    await this.writerActivateQuery(queryDefId, queryKey);
  }

  private async writerSaveEntity(entityKey: number, value: unknown, refIds?: number[]): Promise<void> {
    await this.setValue(entityKey, value, refIds ? new Set(refIds) : undefined);
  }

  private async writerActivateQuery(queryDefId: string, queryKey: number): Promise<void> {
    if (!(await this.delegate!.has(valueKeyFor(queryKey)))) {
      // Query not in store, nothing to do
      return;
    }

    let queue = this.queues.get(queryDefId);

    if (queue === undefined) {
      // For now, use default max count. In a real implementation,
      // we'd need to pass queryDef or maxCount through the message
      const maxCount = DEFAULT_MAX_COUNT;
      queue = await this.delegate!.getBuffer(queueKeyFor(queryDefId));

      if (queue === undefined) {
        queue = new Uint32Array(maxCount);
        await this.delegate!.setBuffer(queueKeyFor(queryDefId), queue);
      } else if (queue.length !== maxCount) {
        queue = new Uint32Array(queue.buffer, 0, maxCount);
        await this.delegate!.setBuffer(queueKeyFor(queryDefId), queue);
      }

      this.queues.set(queryDefId, queue);
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
      await this.deleteValue(evicted);
      await this.delegate!.delete(updatedAtKeyFor(evicted));
    }
  }

  private async setValue(id: number, value: unknown, refIds?: Set<number>): Promise<void> {
    const delegate = this.delegate!;

    await delegate.setString(valueKeyFor(id), JSON.stringify(value));

    const refIdsKey = refIdsKeyFor(id);

    const prevRefIds = await delegate.getBuffer(refIdsKey);

    if (refIds === undefined || refIds.size === 0) {
      await delegate.delete(refIdsKey);

      // Decrement all previous refs
      if (prevRefIds !== undefined) {
        for (let i = 0; i < prevRefIds.length; i++) {
          const refId = prevRefIds[i];
          await this.decrementRefCount(refId);
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
            await this.decrementRefCount(refId);
          }
        }
      }

      // No previous refs, increment all unique new refs
      for (const refId of refIds) {
        await this.incrementRefCount(refId);
      }

      await delegate.setBuffer(refIdsKey, newRefIds);
    }
  }

  private async deleteValue(id: number): Promise<void> {
    const delegate = this.delegate!;

    await delegate.delete(valueKeyFor(id));
    await delegate.delete(refCountKeyFor(id));

    const refIds = await delegate.getBuffer(refIdsKeyFor(id));
    await delegate.delete(refIdsKeyFor(id)); // Clean up the refIds key

    if (refIds === undefined) {
      return;
    }

    // Decrement ref counts for all referenced entities
    for (const refId of refIds) {
      if (refId !== 0) {
        await this.decrementRefCount(refId);
      }
    }
  }

  private async incrementRefCount(refId: number): Promise<void> {
    const delegate = this.delegate!;
    const refCountKey = refCountKeyFor(refId);
    const currentCount = (await delegate.getNumber(refCountKey)) ?? 0;
    const newCount = currentCount + 1;
    await delegate.setNumber(refCountKey, newCount);
  }

  private async decrementRefCount(refId: number): Promise<void> {
    const delegate = this.delegate!;
    const refCountKey = refCountKeyFor(refId);
    const currentCount = await delegate.getNumber(refCountKey);

    if (currentCount === undefined) {
      // Already deleted or never existed
      return;
    }

    const newCount = currentCount - 1;

    if (newCount === 0) {
      // Entity exists, cascade delete it
      await this.deleteValue(refId);
    } else {
      await delegate.setNumber(refCountKey, newCount);
    }
  }
}
