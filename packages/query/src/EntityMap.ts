import { Signal, signal } from 'signalium';
import { EntityDef } from './types.js';
import { createEntityProxy } from './proxy.js';

export interface PreloadedEntityRecord {
  key: number;
  signal: Signal<Record<string, unknown>>;
  cache: Map<PropertyKey, any>;
  proxy?: Record<string, unknown>;
}

export type EntityRecord = Required<PreloadedEntityRecord>;

export class EntityStore {
  private map = new Map<number, PreloadedEntityRecord | EntityRecord>();

  hasEntity(key: number): boolean {
    return this.map.has(key);
  }

  getEntity(key: number): PreloadedEntityRecord | EntityRecord | undefined {
    return this.map.get(key);
  }

  hydratePreloadedEntity(key: number, shape: EntityDef): EntityRecord {
    const record = this.getEntity(key);
    if (record === undefined) {
      throw new Error(`Entity ${key} not found`);
    }

    record.proxy = createEntityProxy(key, record, shape);

    return record as EntityRecord;
  }

  setPreloadedEntity(key: number, obj: Record<string, unknown>): PreloadedEntityRecord {
    const record: PreloadedEntityRecord = {
      key,
      signal: signal(obj),
      cache: new Map(),
      proxy: undefined,
    };

    this.map.set(key, record);

    return record;
  }

  setEntity(key: number, obj: Record<string, unknown>, shape: EntityDef): EntityRecord {
    let record = this.map.get(key);

    if (record === undefined) {
      record = this.setPreloadedEntity(key, obj);

      record.proxy = createEntityProxy(key, record, shape);
    } else {
      record.signal.value = obj;
      record.cache.clear();
    }

    return record as EntityRecord;
  }
}
