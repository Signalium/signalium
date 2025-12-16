import { Signal, signal } from 'signalium';
import { EntityDef } from './types.js';
import { createEntityProxy, mergeValues } from './proxy.js';

export interface PreloadedEntityRecord {
  key: number;
  signal: Signal<Record<string, unknown>>;
  cache: Map<PropertyKey, any>;
  proxy?: Record<string, unknown>;
  entityRefs?: Set<number>;
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

  getNestedEntityRefIds(key: number, refIds: Set<number>): Set<number> {
    const record = this.getEntity(key);

    if (record === undefined) {
      throw new Error(`Entity ${key} not found when getting nested entity ref ids`);
    }

    refIds.add(key);

    // Entangle the signal value. Whenever the signal value is updated, refIds
    // will also be updated, so no need for a second signal.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    record.signal.value;

    if (record.entityRefs !== undefined) {
      for (const ref of record.entityRefs) {
        this.getNestedEntityRefIds(ref, refIds);
      }
    }

    return refIds;
  }

  hydratePreloadedEntity(key: number, shape: EntityDef, scopeOwner?: object): EntityRecord {
    const record = this.getEntity(key);
    if (record === undefined) {
      throw new Error(`Entity ${key} not found`);
    }

    record.proxy = createEntityProxy(key, record, shape, undefined, scopeOwner);

    return record as EntityRecord;
  }

  setPreloadedEntity(key: number, obj: Record<string, unknown>): PreloadedEntityRecord {
    const record: PreloadedEntityRecord = {
      key,
      signal: signal(obj, { equals: false }),
      cache: new Map(),
      proxy: undefined,
      entityRefs: undefined,
    };

    this.map.set(key, record);

    return record;
  }

  setEntity(
    key: number,
    obj: Record<string, unknown>,
    shape: EntityDef,
    entityRefs?: Set<number>,
    scopeOwner?: object,
  ): EntityRecord {
    let record = this.map.get(key);

    if (record === undefined) {
      record = this.setPreloadedEntity(key, obj);

      record.proxy = createEntityProxy(key, record, shape, undefined, scopeOwner);
    } else {
      record.signal.update(value => mergeValues(value, obj));
      record.cache.clear();
    }

    record.entityRefs = entityRefs;

    return record as EntityRecord;
  }
}
