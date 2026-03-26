import { type Notifier, notifier, reactiveSignal, type ReadonlySignal } from 'signalium';
import { LiveFieldType, Mask, type LiveFieldConfig, type EntityDef } from './types.js';
import type { QueryClient } from './QueryClient.js';
import type { EntityInstance } from './EntityInstance.js';
import { getProxyId } from './proxyId.js';
import {
  resolveConstraintHashes,
  computeConstraintHash,
  EVENT_SOURCE_FIELD,
  type FieldPath,
  buildFieldPaths,
} from './ConstraintMatcher.js';
import { ValidatorDef, WRAPPED_VALUE } from './typeDefs.js';

function buildKeySet(items: unknown[]): Set<number> {
  const keys = new Set<number>();
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      const key = getProxyId(item as Record<string, unknown>);
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

// ======================================================
// LiveCollectionParent — structural interface satisfied by EntityInstance
// ======================================================

export interface LiveCollectionParent {
  key: number;
  entityRefs: Map<EntityInstance, number> | undefined;
  liveCollections: LiveCollectionBinding[];
  addChildRef(child: EntityInstance): void;
  removeChildRef(child: EntityInstance): void;
  save(): void;
}

// ======================================================
// LiveInstance — shared interface for LiveArrayInstance and LiveValueInstance
// ======================================================

export interface LiveInstance {
  getValue(): unknown;
  getRawValue(): unknown;
  reset(raw: unknown): void;
  append(raw: unknown): void;
  onEvent(
    entityKey: number,
    entity: unknown,
    entityData: Record<string, unknown>,
    eventType: 'create' | 'update' | 'delete',
  ): void;
}

// ======================================================
// LiveCollectionBinding — shared wrapper for constraint routing
// ======================================================

export class LiveCollectionBinding {
  _queryClient: QueryClient;
  _parent: LiveCollectionParent;
  _constraintHashes: Map<string, number>;
  _entityDefsByTypename: Map<string, ValidatorDef<any>>;
  _constraintFieldRefs: Map<string, Array<[string, unknown]>>;
  readonly instance: LiveInstance;

  constructor(
    entityDefs: ValidatorDef<any>[],
    constraintFieldRefs: Map<string, Array<[string, unknown]>>,
    queryClient: QueryClient,
    parent: LiveCollectionParent,
    constraintHashes: Map<string, number>,
    instance: LiveInstance,
  ) {
    this._queryClient = queryClient;
    this._parent = parent;
    this._constraintHashes = constraintHashes;
    this._constraintFieldRefs = constraintFieldRefs;
    this.instance = instance;

    this._entityDefsByTypename = new Map();
    for (const def of entityDefs) {
      if (def.typenameValue !== undefined) {
        this._entityDefsByTypename.set(def.typenameValue, def);
      }
    }

    WRAPPED_VALUE.add(this);
  }

  getValue(): unknown {
    return this.instance.getValue();
  }

  toJSON(): unknown {
    return this.instance.getRawValue();
  }

  reset(parsed: unknown): void {
    this.instance.reset(parsed);
  }

  append(parsed: unknown): void {
    this.instance.append(parsed);
  }

  /**
   * Handle an entity event. The entity has already been created/updated at the
   * root level by applyMutationEvent. The binding just checks if the entity's
   * current data satisfies this binding's shape and forwards to the instance.
   */
  onEvent(
    typename: string,
    entityKey: number,
    eventType: 'create' | 'update' | 'delete',
    onMatch?: () => void,
    deleteData?: Record<string, unknown>,
  ): void {
    const def = this._entityDefsByTypename.get(typename);
    if (def === undefined) return;
    const entityInstance = this._queryClient.entityMap.getEntity(entityKey);

    if (eventType === 'delete') {
      const entity = entityInstance !== undefined ? entityInstance.getProxy(def as unknown as EntityDef) : deleteData;
      if (entity !== undefined) {
        this.instance.onEvent(entityKey, entity, deleteData ?? entityInstance?.data ?? {}, 'delete');
        onMatch?.();
      }
      return;
    }

    if (entityInstance === undefined) return;
    if (!entityInstance.satisfiesDef(def as unknown as ValidatorDef<unknown>)) return;

    onMatch?.();
    const proxy = entityInstance.getProxy(def as unknown as EntityDef);
    this.instance.onEvent(entityKey, proxy, entityInstance.data, eventType);
  }

  destroy(): void {
    this._queryClient.unregisterLiveCollection(this);
    const collections = this._parent.liveCollections;
    const idx = collections.indexOf(this);
    if (idx !== -1) collections.splice(idx, 1);
  }
}

// ======================================================
// LiveArrayInstance
// ======================================================

export class LiveArrayInstance {
  _notifier: Notifier;
  _items: unknown[];
  _keys: Set<number>;
  _outputSignal: ReadonlySignal<unknown[]> | undefined;
  _queryClient: QueryClient;
  _parent: LiveCollectionParent;

  constructor(
    queryClient: QueryClient,
    parent: LiveCollectionParent,
    items: unknown[],
    constraintFieldPaths?: FieldPath[],
    constraintHash?: number,
    sort?: (a: unknown, b: unknown) => number,
  ) {
    this._notifier = notifier();
    this._items = items;
    this._keys = buildKeySet(items);
    this._queryClient = queryClient;
    this._parent = parent;

    const needsFilter = constraintFieldPaths !== undefined && constraintHash !== undefined;
    const needsSort = sort !== undefined;

    if (needsFilter || needsSort) {
      this._outputSignal = reactiveSignal(() => {
        this._notifier.consume();
        let result = this._items;

        if (needsFilter) {
          const filtered: unknown[] = [];
          for (const item of result) {
            if (typeof item !== 'object' || item === null) {
              filtered.push(item);
              continue;
            }
            const entityKey = getProxyId(item as Record<string, unknown>);
            if (entityKey === undefined) {
              filtered.push(item);
              continue;
            }
            const entity = queryClient.entityMap.getEntity(entityKey);
            if (entity === undefined) {
              filtered.push(item);
              continue;
            }
            entity.consume();
            const hash = computeConstraintHash(entity.data, constraintFieldPaths!);
            if (hash === constraintHash) {
              filtered.push(item);
            }
          }
          result = filtered;
        }

        if (needsSort) {
          result = (result === this._items ? result.slice() : result).sort(sort!);
        }

        return result;
      });
    }
  }

  onEvent(
    entityKey: number,
    entity: unknown,
    _entityData: Record<string, unknown>,
    eventType: 'create' | 'update' | 'delete',
  ): void {
    switch (eventType) {
      case 'create':
        this.add(entityKey, entity!);
        break;
      case 'update':
        if (!this.has(entityKey) && entity !== undefined) {
          this.add(entityKey, entity);
        }
        break;
      case 'delete':
        this.remove(entityKey);
        break;
    }
  }

  getValue(): unknown[] {
    if (this._outputSignal !== undefined) {
      return this._outputSignal.value;
    }
    this._notifier.consume();
    return this._items;
  }

  getRawValue(): unknown[] {
    return this._items;
  }

  add(key: number, proxy: unknown): boolean {
    if (this._keys.has(key)) return false;
    this._keys.add(key);
    this._items.push(proxy);

    const child = this._queryClient.entityMap.getEntity(key);
    if (child !== undefined) {
      this._parent.addChildRef(child);
      child.save();
    }

    this._notifier.notify();
    return true;
  }

  remove(key: number): boolean {
    if (!this._keys.has(key)) return false;
    this._keys.delete(key);
    const idx = this._findIndex(key);
    if (idx !== -1) this._items.splice(idx, 1);

    const child = this._queryClient.entityMap.getEntity(key);
    if (child !== undefined) {
      this._parent.removeChildRef(child);
    }

    this._notifier.notify();
    return true;
  }

  has(key: number): boolean {
    return this._keys.has(key);
  }

  reset(rawValue: unknown): void {
    const oldItems = this._items;
    const newItems = Array.isArray(rawValue) ? rawValue : [];
    this._items = newItems;
    this._keys = buildKeySet(newItems);

    // Add refs for new items BEFORE removing old ones to prevent
    // premature eviction of entities that appear in both arrays.
    for (const item of newItems) {
      if (typeof item === 'object' && item !== null) {
        const key = getProxyId(item as Record<string, unknown>);
        if (key !== undefined) {
          const child = this._queryClient.entityMap.getEntity(key);
          if (child !== undefined) {
            this._parent.addChildRef(child);
          }
        }
      }
    }
    for (const item of oldItems) {
      if (typeof item === 'object' && item !== null) {
        const key = getProxyId(item as Record<string, unknown>);
        if (key !== undefined) {
          const child = this._queryClient.entityMap.getEntity(key);
          if (child !== undefined) {
            this._parent.removeChildRef(child);
          }
        }
      }
    }
    this._notifier.notify();
  }

  append(rawValue: unknown): void {
    if (!Array.isArray(rawValue)) return;
    for (const item of rawValue) {
      if (typeof item !== 'object' || item === null) continue;
      const key = getProxyId(item as Record<string, unknown>);
      if (key !== undefined) {
        this.add(key, item);
      }
    }
  }

  private _findIndex(key: number): number {
    for (let i = 0; i < this._items.length; i++) {
      const item = this._items[i];
      if (typeof item === 'object' && item !== null) {
        if (getProxyId(item as Record<string, unknown>) === key) return i;
      }
    }
    return -1;
  }
}

// ======================================================
// LiveValueInstance
// ======================================================

export class LiveValueInstance {
  _notifier: Notifier;
  _value: unknown;
  _createdKeys: Set<number>;
  _deletedKeys: Set<number>;
  _queryClient: QueryClient;
  _parent: LiveCollectionParent;
  private _onCreate: (value: unknown, entity: unknown) => unknown;
  private _onUpdate: (value: unknown, entity: unknown) => unknown;
  private _onDelete: (value: unknown, entity: unknown) => unknown;

  constructor(
    queryClient: QueryClient,
    parent: LiveCollectionParent,
    initialValue: unknown,
    onCreate: (value: unknown, entity: unknown) => unknown,
    onUpdate: (value: unknown, entity: unknown) => unknown,
    onDelete: (value: unknown, entity: unknown) => unknown,
  ) {
    this._notifier = notifier();
    this._value = initialValue;
    this._createdKeys = new Set();
    this._deletedKeys = new Set();
    this._queryClient = queryClient;
    this._parent = parent;
    this._onCreate = onCreate;
    this._onUpdate = onUpdate;
    this._onDelete = onDelete;
  }

  onEvent(
    entityKey: number,
    entity: unknown,
    entityData: Record<string, unknown>,
    eventType: 'create' | 'update' | 'delete',
  ): void {
    switch (eventType) {
      case 'create':
        if (this._createdKeys.has(entityKey)) return;
        this._createdKeys.add(entityKey);
        this._value = this._onCreate(this._value, entity!);
        break;
      case 'update':
        this._value = this._onUpdate(this._value, entity ?? entityData);
        break;
      case 'delete':
        if (this._deletedKeys.has(entityKey)) return;
        this._deletedKeys.add(entityKey);
        this._value = this._onDelete(this._value, entity ?? entityData);
        break;
    }
    this._notifier.notify();
  }

  getValue(): unknown {
    this._notifier.consume();
    return this._value;
  }

  getRawValue(): unknown {
    return this._value;
  }

  reset(value: unknown): void {
    this._value = value;
    this._createdKeys.clear();
    this._deletedKeys.clear();
    this._notifier.notify();
  }

  append(_value: unknown): void {
    // LiveValue doesn't accumulate — append is a no-op.
    // New page's reducer events are handled via the normal event system.
  }
}

// ======================================================
// Shared factory functions
// ======================================================

export function createLiveCollection(
  config: LiveFieldConfig,
  parsedValue: unknown,
  parent: LiveCollectionParent,
  parentData: Record<string, unknown>,
  queryClient: QueryClient,
): LiveCollectionBinding {
  let constraintFieldRefs = config.constraintFieldRefs;

  if (constraintFieldRefs === undefined) {
    constraintFieldRefs = new Map();
    for (const def of config.entityDefs) {
      const typename = def.typenameValue;
      if (typename !== undefined) {
        constraintFieldRefs.set(typename, [[EVENT_SOURCE_FIELD, parent.key]]);
      }
    }
  }

  const constraintHashes = resolveConstraintHashes(constraintFieldRefs, parentData) ?? new Map();

  let inner: LiveInstance;

  if (config.type === LiveFieldType.Array) {
    let arrayConstraintFieldPaths: FieldPath[] | undefined;
    let arrayConstraintHash: number | undefined;
    if (config.constraintFieldRefs !== undefined && constraintHashes.size > 0) {
      if (constraintHashes.size === 1) {
        for (const [typename] of config.constraintFieldRefs) {
          const hash = constraintHashes.get(typename);
          if (hash !== undefined) {
            arrayConstraintHash = hash;
            const pairs = config.constraintFieldRefs.get(typename);
            if (pairs !== undefined) {
              arrayConstraintFieldPaths = buildFieldPaths(pairs.map(([field]) => field));
            }
            break;
          }
        }
      }
    }
    inner = new LiveArrayInstance(
      queryClient,
      parent,
      Array.isArray(parsedValue) ? parsedValue : [],
      arrayConstraintFieldPaths,
      arrayConstraintHash,
      config.sort,
    );
  } else {
    inner = new LiveValueInstance(
      queryClient,
      parent,
      parsedValue,
      config.onCreate!,
      config.onUpdate!,
      config.onDelete!,
    );
  }

  const binding = new LiveCollectionBinding(
    config.entityDefs,
    constraintFieldRefs,
    queryClient,
    parent,
    constraintHashes,
    inner,
  );

  parent.liveCollections.push(binding);
  queryClient.registerLiveCollection(binding);
  return binding;
}

/**
 * Walk an object shape and create or update LiveCollectionBinding instances for
 * live fields. Values in `data` should already be parsed.
 * Bindings are stored directly in `data[fieldName]`.
 * On first call, creates new bindings. On subsequent calls (e.g. refetch),
 * resets existing instances with fresh data.
 */
export function initializeLiveFields(
  shape: Record<string, unknown>,
  data: Record<string, unknown>,
  previousData: Record<string, unknown> | undefined,
  parent: LiveCollectionParent,
  queryClient: QueryClient,
  appendMode: boolean = false,
): void {
  for (const fieldName of Object.keys(shape)) {
    const fieldDef = shape[fieldName];
    if (!(fieldDef instanceof ValidatorDef)) continue;

    if (fieldDef._liveConfig !== undefined) {
      const config = fieldDef._liveConfig;
      const existing = previousData?.[fieldName];

      if (existing instanceof LiveCollectionBinding) {
        if (appendMode) {
          existing.append(data[fieldName]);
        } else {
          existing.reset(data[fieldName]);
        }
        data[fieldName] = existing;
      } else {
        data[fieldName] = createLiveCollection(config, data[fieldName], parent, data, queryClient);
      }
    } else if (
      (fieldDef.mask & Mask.OBJECT) !== 0 &&
      (fieldDef.mask & (Mask.ENTITY | Mask.ARRAY | Mask.UNION | Mask.RECORD | Mask.LIVE)) === 0 &&
      fieldDef.shape !== undefined
    ) {
      const nestedData = data[fieldName] as Record<string, unknown> | undefined;
      if (nestedData !== undefined && nestedData !== null && typeof nestedData === 'object') {
        const nestedPrevious = previousData?.[fieldName] as Record<string, unknown> | undefined;
        initializeLiveFields(
          fieldDef.shape as Record<string, unknown>,
          nestedData,
          nestedPrevious,
          parent,
          queryClient,
          appendMode,
        );
      }
    }
  }
}
