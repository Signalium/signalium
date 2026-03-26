import { EntityDef } from './types.js';
import type { QueryClient } from './QueryClient.js';
import { EntityInstance } from './EntityInstance.js';
import { ValidatorDef } from './typeDefs.js';

export class EntityStore {
  private instances = new Map<number, EntityInstance>();
  private persistEntity: (key: number, data: Record<string, unknown>, refKeys?: Set<number>) => void;

  constructor(persistEntity: (key: number, data: Record<string, unknown>, refKeys?: Set<number>) => void) {
    this.persistEntity = persistEntity;
  }

  hasEntity(key: number): boolean {
    return this.instances.has(key);
  }

  getEntity(key: number): EntityInstance | undefined {
    return this.instances.get(key);
  }

  getOrCreateEntity(
    key: number,
    data: Record<string, unknown>,
    shape: EntityDef,
    queryClient: QueryClient,
  ): EntityInstance {
    let instance = this.instances.get(key);

    if (instance === undefined) {
      const idField = shape.idField;
      if (idField === undefined) {
        throw new Error(`Entity id field is required ${shape.typenameValue}`);
      }

      const id = (data as Record<string | symbol, unknown>)[idField];
      if (typeof id !== 'string' && typeof id !== 'number') {
        throw new Error(`Entity id must be string or number: ${shape.typenameValue}`);
      }

      const validatorDef = shape as unknown as ValidatorDef<unknown>;

      instance = new EntityInstance(key, shape.typenameValue!, id, idField, data, queryClient);
      instance._entityCache = validatorDef._entityCache;
      this.instances.set(key, instance);
    }

    instance.parseId = queryClient.currentParseId;

    return instance;
  }

  remove(key: number): void {
    this.instances.delete(key);
  }

  save(instance: EntityInstance): void {
    let refKeys: Set<number> | undefined;
    if (instance.entityRefs) {
      refKeys = new Set<number>();
      for (const e of instance.entityRefs.keys()) refKeys.add(e.key);
    }
    this.persistEntity(instance.key, instance.data, refKeys);
  }
}
