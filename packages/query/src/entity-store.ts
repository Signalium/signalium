import { Signal, signal } from 'signalium';
import { createValueProxy } from './entity-proxy.js';
import { LruList } from './lru.js';
import { EntityRef, JSONValue, PersistentKV, toEntityKey, toQueryKey } from './persistence.js';

export interface Entity<T extends Record<string, unknown>> {
  proxy: T;
  signal?: Signal<T>;
  childrenRefs: EntityRef[];
}

interface EntityRecord {
  value: JSONValue;
  consumes: EntityRef[];
}

interface QueryRecord {
  value: JSONValue;
  consumes: EntityRef[];
}

function uniqueKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

function countKey(ref: EntityRef): string {
  return `count:${ref.type}:${ref.id}`;
}

export interface EntityStoreOptions {
  kv: PersistentKV;
  maxCacheSizeByQueryType?: Record<string, number>;
  getEntityRef: (proxy: Record<string, unknown>) => EntityRef;
  serializeEntity?: (entity: Entity<Record<string, unknown>>) => JSONValue;
  getQueryRootRefs?: (value: JSONValue) => EntityRef[];
}

export class EntityStore {
  private readonly kv: PersistentKV;
  private readonly lruByQueryType: Map<string, LruList<string>> = new Map();
  private readonly capacityByType: Record<string, number>;
  private readonly getRef: (proxy: Record<string, unknown>) => EntityRef;
  private readonly serialize: (entity: Entity<Record<string, unknown>>) => JSONValue;
  private readonly getQueryRoots: (value: JSONValue) => EntityRef[];
  private readonly live: Map<string, { notifier: Signal<number>; proxy: any; json: JSONValue | undefined }> = new Map();
  private readonly hydrating: Map<string, Promise<void>> = new Map();

  constructor(options: EntityStoreOptions) {
    this.kv = options.kv;
    this.capacityByType = options.maxCacheSizeByQueryType ?? {};
    this.getRef = options.getEntityRef;
    this.serialize = options.serializeEntity ?? (e => JSON.parse(JSON.stringify(e.proxy)) as JSONValue);
    this.getQueryRoots = options.getQueryRootRefs ?? (() => []);
  }

  // Entities
  async setEntity(entity: Entity<Record<string, unknown>>): Promise<void> {
    const run = async () => {
      const ref = this.getRef(entity.proxy);
      const key = toEntityKey(ref);
      const prev = (await this.kv.get<EntityRecord>(key)) ?? {
        value: null as JSONValue,
        consumes: [],
      };

      // Serialize entity value with embedded references
      const value = this.serialize(entity);

      // Compute next children from current entity children list
      const consumes: EntityRef[] = entity.childrenRefs;

      // Persist entity with new value/consumes first
      const record: EntityRecord = {
        value,
        consumes,
      };
      await this.kv.set(key, record);

      // Diff children: prev.consumes vs consumes (touch only deltas)
      const prevSet = new Set(prev.consumes.map(uniqueKey));
      const nextSet = new Set(consumes.map(uniqueKey));

      // Added children: increment their consumerCount
      for (const child of consumes) {
        const cKey = uniqueKey(child);
        if (!prevSet.has(cKey)) {
          await this.incrementConsumer(child, 1);
        }
      }

      // Removed children: decrement and possibly cascade
      for (const child of prev.consumes) {
        const cKey = uniqueKey(child);
        if (!nextSet.has(cKey)) {
          await this.decrementConsumer(child, 1);
        }
      }

      // Update or create live proxy and notify subscribers
      const ukey = uniqueKey(ref);
      const live = this.live.get(ukey);
      if (live) {
        live.json = value;
        live.notifier.update(v => v + 1);
      } else {
        const notifier = signal(0, { equals: () => false });
        const proxy = this.createEntityProxy(ref, notifier);
        this.live.set(ukey, { notifier, proxy, json: value });
      }
    };

    if (this.kv.transaction) {
      await this.kv.transaction(run);
    } else {
      await run();
    }
  }

  async getEntity(ref: EntityRef): Promise<JSONValue | undefined> {
    const record = await this.kv.get<EntityRecord>(toEntityKey(ref));
    return record?.value;
  }

  async hasEntity(ref: EntityRef): Promise<boolean> {
    const record = await this.kv.get<EntityRecord>(toEntityKey(ref));
    return record !== undefined;
  }

  getEntityProxy<T extends object>(ref: EntityRef): T {
    const key = uniqueKey(ref);
    let live = this.live.get(key);
    if (!live) {
      const notifier = signal(0, { equals: () => false });
      const proxy = this.createEntityProxy(ref, notifier);
      live = { notifier, proxy, json: undefined };
      this.live.set(key, live);
    }
    return live.proxy as T;
  }

  private createEntityProxy(ref: EntityRef, notifier: Signal<number>): any {
    const getNode = () => this.live.get(uniqueKey(ref))?.json;
    this.ensureHydrated(ref);
    return createValueProxy(getNode, r => this.getEntityProxy(r), notifier);
  }

  private ensureHydrated(ref: EntityRef): void {
    const key = uniqueKey(ref);
    const live = this.live.get(key);
    if (live && live.json !== undefined) return;
    if (this.hydrating.has(key)) return;
    const promise = (async () => {
      const record = await this.kv.get<EntityRecord>(toEntityKey(ref));
      const current = this.live.get(key);
      if (current) {
        current.json = record?.value;
        current.notifier.update(v => v + 1);
      } else if (record) {
        const notifier = signal(0, { equals: () => false });
        const proxy = this.createEntityProxy(ref, notifier);
        this.live.set(key, { notifier, proxy, json: record.value });
        notifier.update(v => v + 1);
      }
    })().finally(() => {
      this.hydrating.delete(key);
    });
    this.hydrating.set(key, promise);
  }

  // Queries
  async setQuery(ref: EntityRef, value: JSONValue): Promise<void> {
    const run = async () => {
      const qKey = toQueryKey(ref);
      const prev = (await this.kv.get<QueryRecord>(qKey)) ?? { value, consumes: [] };

      // Persist new query
      const consumes = this.getQueryRoots(value);
      const record: QueryRecord = { value, consumes };
      await this.kv.set(qKey, record);

      // Diff
      const prevSet = new Set(prev.consumes.map(uniqueKey));
      const nextSet = new Set(consumes.map(uniqueKey));

      // Added
      for (const ent of consumes) {
        const k = uniqueKey(ent);
        if (!prevSet.has(k)) {
          await this.incrementConsumer(ent, 1);
        }
      }

      // Removed
      for (const ent of prev.consumes) {
        const k = uniqueKey(ent);
        if (!nextSet.has(k)) {
          await this.decrementConsumer(ent, 1);
        }
      }

      // LRU
      this.touchQuery(ref);

      // Proactively hydrate root entities for this query (non-blocking)
      for (const ent of consumes) {
        this.ensureHydrated(ent);
      }
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
    const cKey = countKey(ref);
    const prev = (await this.kv.get<number>(cKey)) ?? 0;
    const next = Math.max(0, prev + delta);
    await this.kv.set<number>(cKey, next);
  }

  private async decrementConsumer(ref: EntityRef, delta: number): Promise<void> {
    const cKey = countKey(ref);
    const prevCount = (await this.kv.get<number>(cKey)) ?? 0;
    const nextCount = prevCount - delta;
    if (nextCount <= 0) {
      await this.kv.set<number>(cKey, 0);
      await this.cascadeDelete(ref);
    } else {
      await this.kv.set<number>(cKey, nextCount);
    }
  }

  private async cascadeDelete(ref: EntityRef, record?: EntityRecord): Promise<void> {
    const stack: EntityRef[] = [ref];
    const consumedByRef: Map<string, EntityRecord> = new Map();
    if (record) consumedByRef.set(uniqueKey(ref), record);

    while (stack.length) {
      const current = stack.pop()!;
      const cKey = toEntityKey(current);
      const rec = consumedByRef.get(uniqueKey(current)) ?? (await this.kv.get<EntityRecord>(cKey));
      if (!rec) continue;

      const children = rec.consumes.slice();

      await this.kv.delete(cKey);
      await this.kv.set<number>(countKey(current), 0);

      for (const child of children) {
        const cntKey = countKey(child);
        const prev = (await this.kv.get<number>(cntKey)) ?? 0;
        const next = prev - 1;
        if (next <= 0) {
          const childKey = toEntityKey(child);
          const childRec = await this.kv.get<EntityRecord>(childKey);
          await this.kv.set<number>(cntKey, 0);
          if (childRec) {
            await this.kv.delete(childKey);
            consumedByRef.set(uniqueKey(child), childRec);
            stack.push(child);
          }
        } else {
          await this.kv.set<number>(cntKey, next);
        }
      }
    }
  }
}
