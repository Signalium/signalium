import {
  relay,
  type DiscriminatedReactivePromise,
  type Notifier,
  notifier,
  reactiveMethod,
  setScopeOwner,
} from 'signalium';
import { type EntityDef, Mask } from './types.js';
import { GcKeyType } from './GcManager.js';
import { Entity } from './proxy.js';
import { PROXY_ID } from './proxyId.js';
import type { QueryClient } from './QueryClient.js';
import { ValidatorDef, WRAPPED_VALUE } from './typeDefs.js';
import type { LiveCollectionBinding } from './LiveCollection.js';
import { entitySatisfiesShape } from './parseEntities.js';

// ======================================================
// Nested proxy wrapping — transparently unwraps WRAPPED_VALUE items
// (FormattedValue, LiveCollectionBinding) inside plain objects and arrays.
// ======================================================

const ObjectProto = Object.prototype;
const wrappingCache = new WeakMap<object, object>();

function wrapValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (WRAPPED_VALUE.has(value)) return wrapValue((value as { getValue(): unknown }).getValue());
  if (PROXY_ID.has(value as object)) return value;

  if (Array.isArray(value)) {
    let cached = wrappingCache.get(value);
    if (cached === undefined) {
      cached = new Proxy(value, arrayWrappingHandler);
      wrappingCache.set(value, cached);
    }
    return cached;
  }

  if (Object.getPrototypeOf(value) === ObjectProto) {
    let cached = wrappingCache.get(value);
    if (cached === undefined) {
      cached = new Proxy(value as Record<string, unknown>, objectWrappingHandler);
      wrappingCache.set(value, cached);
    }
    return cached;
  }

  return value;
}

const arrayWrappingHandler: ProxyHandler<unknown[]> = {
  get(target, prop, receiver) {
    if (typeof prop === 'string') {
      const idx = Number(prop);
      if (Number.isInteger(idx) && idx >= 0 && idx < target.length) {
        return wrapValue(target[idx]);
      }
    }
    return Reflect.get(target, prop, receiver);
  },
  set() {
    if (IS_DEV) throw new Error('Cannot mutate a read-only array');
    return false;
  },
  deleteProperty() {
    if (IS_DEV) throw new Error('Cannot mutate a read-only array');
    return false;
  },
};

const objectWrappingHandler: ProxyHandler<Record<string, unknown>> = {
  get(target, prop, receiver) {
    if (typeof prop === 'string') {
      return wrapValue(target[prop]);
    }
    return Reflect.get(target, prop, receiver);
  },
  set() {
    if (IS_DEV) throw new Error('Cannot mutate a read-only object');
    return false;
  },
  deleteProperty() {
    if (IS_DEV) throw new Error('Cannot mutate a read-only object');
    return false;
  },
  has(target, prop) {
    return prop in target;
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    return Object.getOwnPropertyDescriptor(target, prop);
  },
};

// ======================================================

export class EntityInstance {
  private _notifier: Notifier;
  _queryClient: QueryClient;
  private _proxies = new Map<ValidatorDef<unknown>, Record<string, unknown>>();

  key: number;
  typename: string;
  id: string | number;
  idField: string | symbol;
  data: Record<string, unknown>;
  refCount: number = 0;
  entityRefs: Map<EntityInstance, number> | undefined;
  liveCollections: LiveCollectionBinding[] = [];
  satisfiedDefs: WeakSet<ValidatorDef<unknown>> = new WeakSet();
  parseId: number = -1;
  _entityCache: { gcTime?: number } | undefined;
  _extraMethods: Record<string, (...args: unknown[]) => unknown> | undefined;
  _extraGetters: Record<string, () => unknown> | undefined;

  constructor(
    key: number,
    typename: string,
    id: string | number,
    idField: string | symbol,
    data: Record<string, unknown>,
    queryClient: QueryClient,
  ) {
    this._notifier = notifier();
    this._queryClient = queryClient;
    this.key = key;
    this.typename = typename;
    this.id = id;
    this.idField = idField;
    this.data = data;
    this.entityRefs = undefined;
  }

  retain(): void {
    this.refCount++;
    const gcTime = this._entityCache?.gcTime;
    if (gcTime !== undefined) {
      this._queryClient.gcManager.cancel(this.key, gcTime);
    }
  }

  release(): void {
    if (--this.refCount > 0) return;
    if (this.refCount < 0) {
      if (IS_DEV) throw new Error(`Entity ${this.typename}:${this.id} released more times than retained`);
      return;
    }
    const gcTime = this._entityCache?.gcTime;
    if (gcTime !== undefined) {
      this._queryClient.gcManager.schedule(this.key, gcTime, GcKeyType.Entity);
    } else {
      this.evict();
    }
  }

  evict(): void {
    const bindings = this.liveCollections.slice();
    this.liveCollections.length = 0;
    for (const binding of bindings) binding.destroy();
    this._queryClient.entityMap.remove(this.key);
    const refs = this.entityRefs;
    this.entityRefs = undefined;
    if (refs) {
      for (const child of refs.keys()) child.release();
    }
  }

  setChildRefs(newRefs: Map<EntityInstance, number> | undefined, persist?: boolean): void {
    const oldRefs = this.entityRefs;
    if (newRefs !== undefined && newRefs.size > 0) {
      for (const child of newRefs.keys()) {
        if (oldRefs === undefined || !oldRefs.has(child)) child.retain();
      }
    }
    if (oldRefs !== undefined && oldRefs.size > 0) {
      for (const child of oldRefs.keys()) {
        if (newRefs === undefined || !newRefs.has(child)) child.release();
      }
    }
    this.entityRefs = newRefs;
    if (persist) this.save();
  }

  addChildRef(child: EntityInstance): void {
    if (this.entityRefs === undefined) this.entityRefs = new Map();
    const count = this.entityRefs.get(child) ?? 0;
    this.entityRefs.set(child, count + 1);
    if (count === 0) child.retain();
    this.save();
  }

  removeChildRef(child: EntityInstance): void {
    if (this.entityRefs === undefined) return;
    const count = this.entityRefs.get(child);
    if (count === undefined) return;
    if (count <= 1) {
      this.entityRefs.delete(child);
      child.release();
    } else {
      this.entityRefs.set(child, count - 1);
    }
    this.save();
  }

  getProxy(shape: EntityDef): Record<string, unknown> {
    const validatorDef = shape as unknown as ValidatorDef<unknown>;
    let proxy = this._proxies.get(validatorDef);
    if (proxy === undefined) {
      proxy = createProxy(this, this.key, shape, this._notifier, this._queryClient);
      this._proxies.set(validatorDef, proxy);
    }
    return proxy;
  }

  get proxy(): Record<string, unknown> | undefined {
    return this._proxies.values().next().value;
  }

  satisfiesDef(def: ValidatorDef<unknown>): boolean {
    if (this.satisfiedDefs.has(def)) return true;
    if (entitySatisfiesShape(this.data, def)) {
      this.satisfiedDefs.add(def);
      return true;
    }
    return false;
  }

  save(): void {
    this._queryClient.entityMap.save(this);
  }

  notify(): void {
    this._notifier.notify();
  }

  consume(): void {
    this._notifier.consume();
  }
}

function filterEntityArray(array: unknown[], innerDef: ValidatorDef<unknown>, queryClient: QueryClient): unknown[] {
  const result: unknown[] = [];
  for (const item of array) {
    if (typeof item !== 'object' || item === null) continue;
    const entityKey = PROXY_ID.get(item);
    if (entityKey === undefined) continue;
    const entityInstance = queryClient.entityMap.getEntity(entityKey);
    if (entityInstance !== undefined && entityInstance.satisfiesDef(innerDef)) {
      result.push(item);
    }
  }
  return result;
}

// ======================================================
// Proxy Creation (module-level function, not a method)
// ======================================================

function createProxy(
  instance: EntityInstance,
  key: number,
  shape: EntityDef,
  entityNotifier: Notifier,
  queryClient: QueryClient,
): Record<string, unknown> {
  const shapeFields = shape.shape ?? {};
  const validatorDef = shape as unknown as ValidatorDef<unknown>;
  const methods = validatorDef._methods;
  const entityClass = validatorDef._entityClass;
  const entityConfig = validatorDef._entityConfig;
  const proto = entityClass ? entityClass.prototype : Entity.prototype;
  const typenameField = shape.typenameField;

  const wrappedMethods = new Map<string, (...args: unknown[]) => unknown>();
  const filterCache = new Map<string, { source: unknown[]; filtered: unknown[] }>();

  const toJSON = () => ({ __entityRef: key });

  let entityRelay: DiscriminatedReactivePromise<Record<string, unknown>> | undefined;

  if (entityConfig?.hasSubscribe && methods && '__subscribe' in methods) {
    entityRelay = relay(state => {
      const onEvent = (event: import('./types.js').MutationEvent) => {
        event.__eventSource = key;
        queryClient.applyMutationEvent(event);
      };

      const unsubscribe = methods['__subscribe'].call(proxy, onEvent);
      state.value = proxy;

      return unsubscribe;
    });
  }

  let proxy: Record<string, unknown>;

  if (IS_DEV && typenameField && !(typenameField in shapeFields)) {
    throw new Error(`typenameField "${typenameField}" must be declared in the entity shape`);
  }

  const baseOwnKeys = Object.keys(shapeFields);
  if (!baseOwnKeys.includes('__typename')) {
    baseOwnKeys.push('__typename');
  }
  if (methods) {
    for (const methodKey of Object.keys(methods)) {
      if (!baseOwnKeys.includes(methodKey)) {
        baseOwnKeys.push(methodKey);
      }
    }
  }

  // Cache the full ownKeys list (including extra methods) — rebuilt when
  // _extraMethods changes (set lazily after entity creation).
  let cachedExtraMethods: Record<string, unknown> | undefined;
  let ownKeysList = baseOwnKeys;

  function getOwnKeys(): string[] {
    const current = instance._extraMethods;
    if (current !== cachedExtraMethods) {
      cachedExtraMethods = current;
      ownKeysList = baseOwnKeys.slice();
      if (current !== undefined) {
        for (const methodKey of Object.keys(current)) {
          if (!ownKeysList.includes(methodKey)) {
            ownKeysList.push(methodKey);
          }
        }
      }
      const getters = instance._extraGetters;
      if (getters !== undefined) {
        for (const getterKey of Object.keys(getters)) {
          if (!ownKeysList.includes(getterKey)) {
            ownKeysList.push(getterKey);
          }
        }
      }
    }
    return ownKeysList;
  }

  const handler: ProxyHandler<object> = {
    getPrototypeOf() {
      return proto;
    },

    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'toJSON') return toJSON;
      if (prop === '__context') return queryClient.getContext();
      if (prop === '__typename') return instance.typename;

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      entityRelay?.value;

      entityNotifier.consume();

      if (typeof prop === 'string') {
        const extraGetters = instance._extraGetters;
        if (extraGetters !== undefined && prop in extraGetters) {
          return extraGetters[prop]();
        }

        const extraMethods = instance._extraMethods;
        if (extraMethods !== undefined && prop in extraMethods) {
          let bound = wrappedMethods.get(prop);
          if (!bound) {
            bound = extraMethods[prop].bind(proxy);
            wrappedMethods.set(prop, bound);
          }
          return bound;
        }

        if (methods && prop in methods) {
          let wrapped = wrappedMethods.get(prop);
          if (!wrapped) {
            wrapped = reactiveMethod(proxy, methods[prop].bind(proxy));
            wrappedMethods.set(prop, wrapped);
          }
          return wrapped;
        }
      }

      const value = instance.data[prop as string];

      if (typeof value === 'object' && value !== null && WRAPPED_VALUE.has(value)) {
        return wrapValue((value as { getValue(): unknown }).getValue());
      }

      if (Array.isArray(value) && typeof prop === 'string') {
        const fieldDef = shapeFields[prop];
        if (fieldDef instanceof ValidatorDef && (fieldDef.mask & Mask.ARRAY) !== 0) {
          const innerDef = fieldDef.shape as ValidatorDef<unknown> | undefined;
          if (innerDef instanceof ValidatorDef && (innerDef.mask & Mask.ENTITY) !== 0) {
            const typename = innerDef.typenameValue;
            if (typename !== undefined) {
              const defs = queryClient.getEntityDefsForTypename(typename);
              if (defs !== undefined && defs.length > 1) {
                const cached = filterCache.get(prop);
                if (cached !== undefined && cached.source === value) {
                  return wrapValue(cached.filtered);
                }
                const filtered = filterEntityArray(value, innerDef, queryClient);
                filterCache.set(prop, { source: value, filtered });
                return wrapValue(filtered);
              }
            }
          }
        }
        return wrapValue(value);
      }

      return wrapValue(value);
    },

    set() {
      if (IS_DEV) throw new Error('Entity properties are read-only');
      return false;
    },

    has(target, prop) {
      if (prop === '__typename') return true;
      if (typeof prop === 'string') {
        const extraGetters = instance._extraGetters;
        if (extraGetters && prop in extraGetters) return true;
        const extraMethods = instance._extraMethods;
        if (extraMethods && prop in extraMethods) return true;
        if (methods && prop in methods) return true;
      }
      return prop in shapeFields;
    },

    ownKeys() {
      return getOwnKeys();
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop === '__typename') {
        return { enumerable: true, configurable: true, value: instance.typename, writable: false };
      }
      if (prop in shapeFields) {
        return { enumerable: true, configurable: true, value: handler.get!(target, prop, proxy), writable: false };
      }
      if (typeof prop === 'string') {
        const extraGetters = instance._extraGetters;
        if (extraGetters && prop in extraGetters) {
          return { enumerable: true, configurable: true, value: handler.get!(target, prop, proxy), writable: false };
        }
        const extraMethods = instance._extraMethods;
        if (extraMethods && prop in extraMethods) {
          return { enumerable: true, configurable: true, value: handler.get!(target, prop, proxy), writable: false };
        }
        if (methods && prop in methods) {
          return { enumerable: false, configurable: true, value: handler.get!(target, prop, proxy), writable: false };
        }
      }
      return undefined;
    },
  };

  proxy = new Proxy<Record<string, unknown>>({} as Record<string, unknown>, handler);

  PROXY_ID.set(proxy, key);
  setScopeOwner(proxy, queryClient);

  return proxy;
}
