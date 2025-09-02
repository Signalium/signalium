import { LruList } from './lru';
import { EntityRef, JSONValue, PersistentKV, toEntityKey, toQueryKey } from './persistence';

interface EntityRecord {
  value: JSONValue;
  consumerCount: number;
  consumes: EntityRef[];
}

interface QueryRecord {
  value: JSONValue;
  consumes: EntityRef[];
}

function uniqueKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

export interface EntityStoreOptions {
  kv: PersistentKV;
  maxCacheSizeByQueryType?: Record<string, number>;
}

export class EntityStore {
  private readonly kv: PersistentKV;
  private readonly lruByQueryType: Map<string, LruList<string>> = new Map();
  private readonly capacityByType: Record<string, number>;

  constructor(options: EntityStoreOptions) {
    this.kv = options.kv;
    this.capacityByType = options.maxCacheSizeByQueryType ?? {};
  }

  // Entities
  async setEntity(ref: EntityRef, value: JSONValue, consumes: EntityRef[] = []): Promise<void> {
    const key = toEntityKey(ref);
    const record: EntityRecord = {
      value,
      consumes,
      consumerCount: (await this.kv.get<EntityRecord>(key))?.consumerCount ?? 0,
    };
    await this.kv.set(key, record);
  }

  async getEntity(ref: EntityRef): Promise<JSONValue | undefined> {
    const record = await this.kv.get<EntityRecord>(toEntityKey(ref));
    return record?.value;
  }

  async hasEntity(ref: EntityRef): Promise<boolean> {
    const record = await this.kv.get<EntityRecord>(toEntityKey(ref));
    return record !== undefined;
  }

  // Queries
  async setQuery(ref: EntityRef, value: JSONValue, consumes: EntityRef[]): Promise<void> {
    const run = async () => {
      const qKey = toQueryKey(ref);
      const prev = (await this.kv.get<QueryRecord>(qKey)) ?? { value, consumes: [] };

      // Persist new query
      const record: QueryRecord = { value, consumes };
      await this.kv.set(qKey, record);

      // Diff
      const prevSet = new Set(prev.consumes.map(uniqueKey));
      const nextSet = new Set(consumes.map(uniqueKey));

      // Added
      for (const ent of consumes) {
        const key = uniqueKey(ent);
        if (!prevSet.has(key)) {
          await this.incrementConsumer(ent, 1);
        }
      }

      // Removed
      for (const ent of prev.consumes) {
        const key = uniqueKey(ent);
        if (!nextSet.has(key)) {
          await this.decrementConsumer(ent, 1);
        }
      }

      // LRU
      this.touchQuery(ref);
    };

    if (this.kv.transaction) {
      await this.kv.transaction(run);
    } else {
      await run();
    }
  }

  async getQuery(ref: EntityRef): Promise<JSONValue | undefined> {
    const record = await this.kv.get<QueryRecord>(toQueryKey(ref));
    if (record) this.touchQuery(ref);
    return record?.value;
  }

  async hasQuery(ref: EntityRef): Promise<boolean> {
    const record = await this.kv.get<QueryRecord>(toQueryKey(ref));
    return record !== undefined;
  }

  async evictQuery(ref: EntityRef): Promise<void> {
    const run = async () => {
      const qKey = toQueryKey(ref);
      const record = await this.kv.get<QueryRecord>(qKey);
      if (!record) return;

      await this.kv.delete(qKey);

      // decrement and cascade
      for (const ent of record.consumes) {
        await this.decrementConsumer(ent, 1);
      }

      // LRU remove
      const lru = this.getLru(ref.type);
      lru.remove(ref.id);
    };

    if (this.kv.transaction) {
      await this.kv.transaction(run);
    } else {
      await run();
    }
  }

  // LRU
  touchQuery(ref: EntityRef): void {
    const lru = this.getLru(ref.type);
    const evictedId = lru.touch(ref.id);
    if (evictedId) {
      // fire-and-forget eviction; do not await synchronously to avoid reentrancy
      void this.evictQuery({ type: ref.type, id: evictedId });
    }
  }

  private getLru(queryType: string): LruList<string> {
    let lru = this.lruByQueryType.get(queryType);
    if (!lru) {
      const capacity = this.capacityByType[queryType] ?? 0;
      lru = new LruList<string>(capacity);
      this.lruByQueryType.set(queryType, lru);
    }
    return lru;
  }

  // Count helpers and cascading delete
  private async incrementConsumer(ref: EntityRef, delta: number): Promise<void> {
    const eKey = toEntityKey(ref);
    const record = (await this.kv.get<EntityRecord>(eKey)) ?? {
      value: null,
      consumerCount: 0,
      consumes: [],
    };
    record.consumerCount += delta;
    if (record.consumerCount < 0) record.consumerCount = 0;
    await this.kv.set(eKey, record);
  }

  private async decrementConsumer(ref: EntityRef, delta: number): Promise<void> {
    const eKey = toEntityKey(ref);
    const record = await this.kv.get<EntityRecord>(eKey);
    if (!record) return; // nothing to do

    record.consumerCount -= delta;
    if (record.consumerCount <= 0) {
      // delete and cascade
      await this.cascadeDelete(ref, record);
    } else {
      await this.kv.set(eKey, record);
    }
  }

  private async cascadeDelete(ref: EntityRef, record?: EntityRecord): Promise<void> {
    // Depth-first deletion of entities whose consumerCount hit 0
    const stack: EntityRef[] = [ref];
    const consumedByRef: Map<string, EntityRecord> = new Map();
    if (record) consumedByRef.set(uniqueKey(ref), record);

    while (stack.length) {
      const current = stack.pop()!;
      const cKey = toEntityKey(current);
      const rec = consumedByRef.get(uniqueKey(current)) ?? (await this.kv.get<EntityRecord>(cKey));
      if (!rec) continue;

      // capture children before delete
      const children = rec.consumes.slice();

      // delete current
      await this.kv.delete(cKey);

      // decrement children and enqueue if they hit 0
      for (const child of children) {
        const childKey = toEntityKey(child);
        const childRec = await this.kv.get<EntityRecord>(childKey);
        if (!childRec) continue;
        childRec.consumerCount -= 1;
        if (childRec.consumerCount <= 0) {
          await this.kv.delete(childKey);
          // push for cascading its children; need record to read its consumes later
          consumedByRef.set(uniqueKey(child), childRec);
          stack.push(child);
        } else {
          await this.kv.set(childKey, childRec);
        }
      }
    }
  }
}
