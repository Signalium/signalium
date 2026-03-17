import {
  relay,
  type DiscriminatedReactivePromise,
  type Notifier,
  notifier,
  reactiveMethod,
  setScopeOwner,
} from 'signalium';
import { EntityDef, TypeDef } from './types.js';
import { mergeValues, parseValue, Entity, type WarnFn } from './proxy.js';
import { PROXY_ID } from './proxyId.js';
import type { QueryClient } from './QueryClient.js';
import { ValidatorDef } from './typeDefs.js';

export class EntityInstance {
  private _notifier: Notifier;

  data: Record<string, unknown>;
  cache: Map<PropertyKey, any>;
  proxy: Record<string, unknown>;
  entityRefs: Set<number> | undefined;
  parseId: number;
  shapeDef: ValidatorDef<unknown>;

  constructor(key: number, data: Record<string, unknown>, shape: EntityDef, queryClient: QueryClient) {
    const idField = shape.idField;
    if (idField === undefined) {
      throw new Error(`Entity id field is required ${shape.typenameValue}`);
    }

    const id = data[idField];
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new Error(`Entity id must be string or number: ${shape.typenameValue}`);
    }

    const entityNotifier = notifier();

    this._notifier = entityNotifier;
    this.data = data;
    this.cache = new Map();
    this.entityRefs = undefined;
    this.parseId = -1;
    this.shapeDef = shape as unknown as ValidatorDef<unknown>;
    this.proxy = createProxy(this, key, id, shape, entityNotifier, queryClient);
  }

  update(newData: Record<string, unknown>): void {
    const { _notifier, cache } = this;
    this.data = mergeValues(this.data, newData);
    _notifier.notify();
    cache.clear();
  }
}

// ======================================================
// Proxy Creation (module-level function, not a method)
// ======================================================

const noopWarn: WarnFn = () => {};

function createProxy(
  instance: EntityInstance,
  key: number,
  id: string | number,
  shape: EntityDef,
  entityNotifier: Notifier,
  queryClient: QueryClient,
): Record<string, unknown> {
  const shapeFields = shape.shape;
  const validatorDef = shape as unknown as ValidatorDef<unknown>;
  const methods = validatorDef._methods;
  const entityClass = validatorDef._entityClass;
  const entityConfig = validatorDef._entityConfig;
  const proto = entityClass ? entityClass.prototype : Entity.prototype;
  const typenameField = shape.typenameField;
  const warn = queryClient.getContext().log?.warn ?? noopWarn;
  const desc = `${shape.typenameValue}:${id}`;

  const wrappedMethods = new Map<string, (...args: unknown[]) => unknown>();

  const toJSON = () => ({ __entityRef: key });

  let entityRelay: DiscriminatedReactivePromise<Record<string, unknown>> | undefined;

  if (entityConfig?.stream) {
    entityRelay = relay(state => {
      const context = queryClient.getContext();
      const onUpdate = (update: Partial<Record<string, unknown>>) => {
        instance.data = mergeValues(instance.data, update);
        entityNotifier.notify();
        instance.cache.clear();
      };

      const unsubscribe = entityConfig.stream.subscribe(context, id as string | number, onUpdate as any);
      state.value = proxy;

      return unsubscribe;
    });
  }

  let proxy: Record<string, unknown>;

  const handler: ProxyHandler<object> = {
    getPrototypeOf() {
      return proto;
    },

    get(target, prop) {
      if (prop === 'toJSON') return toJSON;

      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      entityRelay?.value;

      entityNotifier.consume();

      const { data, cache } = instance;

      if (cache.has(prop)) {
        return cache.get(prop);
      }

      if (methods && typeof prop === 'string' && prop in methods) {
        let wrapped = wrappedMethods.get(prop);
        if (!wrapped) {
          wrapped = reactiveMethod(proxy, methods[prop].bind(proxy));
          wrappedMethods.set(prop, wrapped);
        }
        return wrapped;
      }

      const value = data[prop as string];

      if (!Object.hasOwnProperty.call(shapeFields, prop)) {
        return value;
      }

      const propDef = shapeFields[prop as string];
      const parsed = parseValue(value, propDef as unknown as TypeDef, `[[${desc}]].${prop as string}`, false, warn);

      cache.set(prop, parsed);

      return parsed;
    },

    has(target, prop) {
      if (methods && typeof prop === 'string' && prop in methods) {
        return true;
      }
      return prop in shapeFields;
    },

    ownKeys() {
      const keys = Object.keys(shapeFields);
      if (typenameField && !keys.includes(typenameField)) {
        keys.push(typenameField);
      }
      if (methods) {
        for (const methodKey of Object.keys(methods)) {
          if (!keys.includes(methodKey)) {
            keys.push(methodKey);
          }
        }
      }
      return keys;
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop in shapeFields || prop === typenameField) {
        return { enumerable: true, configurable: true };
      }
      if (methods && typeof prop === 'string' && prop in methods) {
        return { enumerable: false, configurable: true };
      }
      return undefined;
    },
  };

  proxy = new Proxy<Record<string, unknown>>({} as Record<string, unknown>, handler);

  PROXY_ID.set(proxy, key);
  setScopeOwner(proxy, queryClient);

  return proxy;
}
