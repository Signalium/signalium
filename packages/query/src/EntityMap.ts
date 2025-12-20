import { relay, DiscriminatedReactivePromise, Notifier, notifier } from 'signalium';
import { EntityDef } from './types.js';
import { createEntityProxy, mergeValues } from './proxy.js';
import type { QueryClient } from './QueryClient.js';
import { ValidatorDef } from './typeDefs.js';

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

export class EntityStore {
  private map = new Map<number, PreloadedEntityRecord | EntityRecord>();
  private queryClient: QueryClient;

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
    }

    record.entityRefs = entityRefs;

    return record as EntityRecord;
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
