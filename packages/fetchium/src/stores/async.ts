import { QueryDefinition } from '../query.js';
import { CachedQuery, QueryStore, type PreloadedEntityMap } from '../QueryClient.js';
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

  getAllKeys(): Promise<string[]>;
}

const enum StoreMessageType {
  SaveQuery = 0,
  SaveEntity = 1,
  ActivateQuery = 2,
  DeleteQuery = 3,
}

export type StoreMessage =
  | {
      type: StoreMessageType.SaveQuery;
      queryDefId: string;
      queryKey: number;
      value: unknown;
      updatedAt: number;
      cacheTime: number;
      refIds?: number[];
    }
  | { type: StoreMessageType.SaveEntity; entityKey: number; value: unknown; refIds?: number[] }
  | { type: StoreMessageType.ActivateQuery; queryDefId: string; queryKey: number; cacheTime: number }
  | { type: StoreMessageType.DeleteQuery; queryKey: number };

export interface AsyncQueryStoreConfig {
  isWriter: boolean;
  connect: (handleMessage: (msg: StoreMessage) => void) => {
    sendMessage: (msg: StoreMessage) => void;
  };
  delegate?: AsyncPersistentStore; // Only provided for writer
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

  private dispatch(msg: StoreMessage): void {
    if (this.isWriter) {
      this.enqueueMessage(msg);
    } else {
      this.sendMessage(msg);
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
      case StoreMessageType.SaveQuery:
        await this.writerSaveQuery(msg.queryDefId, msg.queryKey, msg.value, msg.updatedAt, msg.cacheTime, msg.refIds);
        break;
      case StoreMessageType.SaveEntity:
        await this.writerSaveEntity(msg.entityKey, msg.value, msg.refIds);
        break;
      case StoreMessageType.ActivateQuery:
        await this.writerActivateQuery(msg.queryDefId, msg.queryKey, msg.cacheTime);
        break;
      case StoreMessageType.DeleteQuery:
        await this.writerDeleteValue(msg.queryKey);
        break;
    }
  }

  async loadQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): Promise<CachedQuery | undefined> {
    if (!this.delegate) {
      return undefined;
    }

    const updatedAt = await this.delegate.getNumber(updatedAtKeyFor(queryKey));

    const cacheTimeMs = (queryDef.statics.cache?.cacheTime ?? DEFAULT_CACHE_TIME) * 60 * 1000;
    if (updatedAt === undefined || updatedAt < Date.now() - cacheTimeMs) {
      return undefined;
    }

    const valueStr = await this.delegate.getString(valueKeyFor(queryKey));

    if (valueStr === undefined) {
      return undefined;
    }

    const entityIds = await this.delegate.getBuffer(refIdsKeyFor(queryKey));

    let preloadedEntities: PreloadedEntityMap | undefined;
    if (entityIds !== undefined) {
      preloadedEntities = new Map();
      await this.preloadEntities(entityIds, preloadedEntities);
    }

    this.activateQuery(queryDef, queryKey);

    return {
      value: JSON.parse(valueStr) as Record<string, unknown>,
      refIds: entityIds === undefined ? undefined : new Set(entityIds ?? []),
      updatedAt,
      preloadedEntities,
    };
  }

  private async preloadEntities(entityIds: Uint32Array, preloaded: PreloadedEntityMap): Promise<void> {
    if (!this.delegate) {
      return;
    }

    for (const entityId of entityIds) {
      const entityValue = await this.delegate.getString(valueKeyFor(entityId));

      if (entityValue === undefined) {
        continue;
      }

      preloaded.set(entityId, JSON.parse(entityValue) as Record<string, unknown>);

      const childIds = await this.delegate.getBuffer(refIdsKeyFor(entityId));

      if (childIds === undefined) {
        continue;
      }

      await this.preloadEntities(childIds, preloaded);
    }
  }

  saveQuery(
    queryDef: QueryDefinition<any, any, any>,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    refIds?: Set<number>,
  ): void {
    const message: StoreMessage = {
      type: StoreMessageType.SaveQuery,
      queryDefId: queryDef.statics.id,
      queryKey,
      value,
      updatedAt,
      cacheTime: queryDef.statics.cache?.cacheTime ?? DEFAULT_CACHE_TIME,
      refIds: refIds ? Array.from(refIds) : undefined,
    };

    this.dispatch(message);
  }

  saveEntity(entityKey: number, value: unknown, refIds?: Set<number>): void {
    const message: StoreMessage = {
      type: StoreMessageType.SaveEntity,
      entityKey,
      value,
      refIds: refIds ? Array.from(refIds) : undefined,
    };

    this.dispatch(message);
  }

  activateQuery(queryDef: QueryDefinition<any, any, any>, queryKey: number): void {
    const message: StoreMessage = {
      type: StoreMessageType.ActivateQuery,
      queryDefId: queryDef.statics.id,
      queryKey,
      cacheTime: queryDef.statics.cache?.cacheTime ?? DEFAULT_CACHE_TIME,
    };

    this.dispatch(message);
  }

  deleteQuery(queryKey: number): void {
    const message: StoreMessage = {
      type: StoreMessageType.DeleteQuery,
      queryKey,
    };

    this.dispatch(message);
  }

  // Writer-specific methods below

  private async writerSaveQuery(
    queryDefId: string,
    queryKey: number,
    value: unknown,
    updatedAt: number,
    cacheTime: number,
    refIds?: number[],
  ): Promise<void> {
    await this.setValue(queryKey, value, refIds ? new Set(refIds) : undefined);
    await this.delegate!.setNumber(updatedAtKeyFor(queryKey), updatedAt);
    await this.writerActivateQuery(queryDefId, queryKey, cacheTime);
  }

  private async writerSaveEntity(entityKey: number, value: unknown, refIds?: number[]): Promise<void> {
    await this.setValue(entityKey, value, refIds ? new Set(refIds) : undefined);
  }

  private async writerActivateQuery(queryDefId: string, queryKey: number, cacheTime: number): Promise<void> {
    if (!(await this.delegate!.has(valueKeyFor(queryKey)))) {
      return;
    }

    const queueKey = queueKeyFor(queryDefId);
    let queue = this.queues.get(queryDefId);

    if (queue === undefined) {
      const maxCount = DEFAULT_MAX_COUNT;
      queue = await this.delegate!.getBuffer(queueKey);

      if (queue === undefined) {
        queue = new Uint32Array(maxCount);
        await this.delegate!.setBuffer(queueKey, queue);
      } else if (queue.length !== maxCount) {
        queue = new Uint32Array(queue.buffer, 0, maxCount);
        await this.delegate!.setBuffer(queueKey, queue);
      }

      this.queues.set(queryDefId, queue);
    }

    await this.delegate!.setNumber(lastUsedKeyFor(queryDefId), Date.now());
    await this.delegate!.setNumber(cacheTimeKeyFor(queryDefId), cacheTime);

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
      await this.writerDeleteValue(evicted);
      await this.delegate!.delete(updatedAtKeyFor(evicted));
    }
  }

  async purgeStaleQueries(): Promise<void> {
    if (!this.delegate) return;

    const allKeys = await this.delegate.getAllKeys();
    const now = Date.now();

    for (const key of allKeys) {
      if (!key.startsWith(LAST_USED_PREFIX)) continue;

      const queryDefId = key.slice(LAST_USED_PREFIX.length);
      const lastUsedAt = await this.delegate.getNumber(key);
      const cacheTime = (await this.delegate.getNumber(cacheTimeKeyFor(queryDefId))) ?? DEFAULT_CACHE_TIME;
      const cacheTimeMs = cacheTime * 60 * 1000;

      if (lastUsedAt === undefined || now - lastUsedAt > cacheTimeMs) {
        const queue = await this.delegate.getBuffer(queueKeyFor(queryDefId));

        if (queue !== undefined) {
          for (const queryKey of queue) {
            if (queryKey !== 0) {
              await this.writerDeleteValue(queryKey);
              await this.delegate.delete(updatedAtKeyFor(queryKey));
            }
          }
        }

        await this.delegate.delete(queueKeyFor(queryDefId));
        await this.delegate.delete(key);
        await this.delegate.delete(cacheTimeKeyFor(queryDefId));
        this.queues.delete(queryDefId);
      }
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

  private async writerDeleteValue(id: number): Promise<void> {
    const delegate = this.delegate!;
    const refIdsKey = refIdsKeyFor(id);

    await delegate.delete(valueKeyFor(id));
    await delegate.delete(refCountKeyFor(id));

    const refIds = await delegate.getBuffer(refIdsKey);
    await delegate.delete(refIdsKey); // Clean up the refIds key

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
      await this.writerDeleteValue(refId);
    } else {
      await delegate.setNumber(refCountKey, newCount);
    }
  }
}
