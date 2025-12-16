import { reactiveMethod, setScopeOwner } from 'signalium';
import { typeError } from './errors.js';
import { CaseInsensitiveSet, getFormat, ValidatorDef } from './typeDefs.js';
import {
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  EntityMethods,
  Mask,
  ObjectDef,
  RECORD_KEY,
  ObjectFieldTypeDef,
  UnionDef,
  TypeDef,
} from './types.js';
import { typeMaskOf } from './utils.js';
import { PreloadedEntityRecord } from './EntityMap.js';

const entries = Object.entries;
const isArray = Array.isArray;

const PROXY_ID = new WeakMap();

function parseUnionValue(
  valueType: number,
  value: Record<string, unknown> | unknown[],
  unionDef: UnionDef,
  path: string,
): unknown {
  if (valueType === Mask.ARRAY) {
    const shape = unionDef.shape![ARRAY_KEY];

    if (shape === undefined || typeof shape === 'number') {
      return value;
    }

    return parseArrayValue(value as unknown[], shape, path);
  } else {
    // Use the cached typename field from the union definition
    const typenameField = unionDef.typenameField;
    const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;

    if (typename === undefined || typeof typename !== 'string') {
      const recordShape = unionDef.shape![RECORD_KEY];

      if (recordShape === undefined || typeof recordShape === 'number') {
        // Union of objects/entities requires typename for discrimination
        throw new Error(
          `Typename field '${typenameField}' is required for union discrimination but was not found in the data`,
        );
      }

      return parseRecordValue(value as Record<string, unknown>, recordShape as ComplexTypeDef, path);
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      return value;
    }

    return parseObjectValue(value as Record<string, unknown>, matchingDef as ObjectDef | EntityDef, path);
  }
}

export function parseArrayValue(array: unknown[], arrayShape: TypeDef, path: string) {
  for (let i = 0; i < array.length; i++) {
    array[i] = parseValue(array[i], arrayShape, `${path}[${i}]`);
  }

  return array;
}

export function parseRecordValue(record: Record<string, unknown>, recordShape: ComplexTypeDef, path: string) {
  for (const [key, value] of entries(record)) {
    record[key] = parseValue(value, recordShape, `${path}["${key}"]`);
  }

  return record;
}

export function parseObjectValue(object: Record<string, unknown>, objectShape: ObjectDef | EntityDef, path: string) {
  if (PROXY_ID.has(object)) {
    // Is an entity proxy, so return it directly
    return object;
  }

  const shape = objectShape.shape;

  for (const [key, propShape] of entries(shape)) {
    // parse and replace the property in place
    object[key] = parseValue(object[key], propShape, `${path}.${key}`);
  }

  return object;
}

export function parseValue(value: unknown, propDef: ObjectFieldTypeDef, path: string): unknown {
  // Handle case-insensitive enums
  if (propDef instanceof CaseInsensitiveSet) {
    const canonical = propDef.get(value);
    if (canonical === undefined) {
      throw typeError(path, propDef as any, value);
    }
    return canonical; // Return the canonical casing
  }

  // Handle Set-based constants/enums
  if (propDef instanceof Set) {
    if (!propDef.has(value as string | boolean | number)) {
      throw typeError(path, propDef as any, value);
    }
    return value;
  }

  switch (typeof propDef) {
    case 'string':
      // If value is undefined/null, return the typename from definition
      if (value === undefined || value === null) {
        return propDef;
      }
      if (value !== propDef) {
        throw typeError(path, propDef, value);
      }

      return value;

    // handle primitives
    case 'number': {
      let valueType = typeMaskOf(value);

      if ((propDef & valueType) === 0) {
        throw typeError(path, propDef, value);
      }

      if ((propDef & Mask.HAS_NUMBER_FORMAT) !== 0 && valueType === Mask.NUMBER) {
        return getFormat(propDef)(value);
      }

      if ((propDef & Mask.HAS_STRING_FORMAT) !== 0 && valueType === Mask.STRING) {
        return getFormat(propDef)(value);
      }
      return value;
    }

    // handle complex objects
    default: {
      // Note: Keep in mind that at this point, we're using `valueType`
      // primarily, so some of the logic is "reversed" from the above where
      // we use the `propDef` type primarily
      let valueType = typeMaskOf(value);
      const propMask = propDef.mask;

      // Check if the value type is allowed by the propMask
      // Also check if it's in a values set (for enums/constants stored in ValidatorDef)
      if ((propMask & valueType) === 0 && !propDef.values?.has(value as string | boolean | number)) {
        throw typeError(path, propMask, value);
      }

      if (valueType < Mask.OBJECT) {
        if ((propMask & Mask.HAS_NUMBER_FORMAT) !== 0 && valueType === Mask.NUMBER) {
          return getFormat(propMask)(value);
        }

        if ((propMask & Mask.HAS_STRING_FORMAT) !== 0 && valueType === Mask.STRING) {
          return getFormat(propMask)(value);
        }

        // value is a primitive, it has already passed the mask so return it now
        return value;
      }

      if ((valueType & Mask.UNION) !== 0) {
        return parseUnionValue(valueType, value as Record<string, unknown> | unknown[], propDef as UnionDef, path);
      }

      if (valueType === Mask.ARRAY) {
        return parseArrayValue(value as unknown[], propDef.shape as ComplexTypeDef, path);
      }

      return parseObjectValue(value as Record<string, unknown>, propDef as ObjectDef | EntityDef, path);
    }
  }
}

/**
 * Deep merge two objects, with the update object taking precedence.
 * Arrays are replaced, not merged.
 * Handles nested objects recursively.
 */
export function mergeValues<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  update: Record<string, unknown>,
): T {
  // Iterate over update properties
  for (const [key, value] of entries(update)) {
    if (typeof value === 'object' && value !== null && !isArray(value) && !PROXY_ID.has(value)) {
      mergeValues(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }

  return target as T;
}

const CustomNodeInspect = Symbol.for('nodejs.util.inspect.custom');

export function createEntityProxy(
  id: number,
  entityRecord: PreloadedEntityRecord,
  def: ObjectDef | EntityDef,
  desc?: string,
  scopeOwner?: object,
): Record<string, unknown> {
  // Cache for nested proxies - each proxy gets its own cache
  const shape = def.shape;

  // Get cached methods from the definition (evaluated once during reifyShape)
  const methods = (def as ValidatorDef<unknown>).methods;

  // Cache for wrapped reactive methods - each proxy gets its own bound methods
  const wrappedMethods = new Map<string, (...args: unknown[]) => unknown>();

  const toJSON = () => ({
    __entityRef: id,
  });

  // We need to declare proxy first so we can reference it in the handler
  let proxy: Record<string, unknown>;

  const handler: ProxyHandler<object> = {
    get(target, prop) {
      // Handle toJSON for serialization
      if (prop === 'toJSON') {
        return toJSON;
      }

      const { signal, cache } = entityRecord;
      const obj = signal.value;

      // Check cache first, BEFORE any expensive checks
      if (cache.has(prop)) {
        return cache.get(prop);
      }

      // Check for method access
      if (methods && typeof prop === 'string' && prop in methods) {
        let wrapped = wrappedMethods.get(prop);
        if (!wrapped) {
          // Create reactive method wrapper bound to the proxy
          // Bind the method to the proxy so `this` refers to the entity
          wrapped = reactiveMethod(proxy, methods[prop].bind(proxy));
          wrappedMethods.set(prop, wrapped);
        }
        return wrapped;
      }

      const value = obj[prop as string];
      const propDef = shape[prop as string];

      if (!Object.hasOwnProperty.call(shape, prop)) {
        return value;
      }

      const parsed = parseValue(value, propDef, `[[${desc}]].${prop as string}`);

      cache.set(prop, parsed);

      return parsed;
    },

    has(target, prop) {
      // Include methods in the "in" check
      if (methods && typeof prop === 'string' && prop in methods) {
        return true;
      }
      return prop in shape;
    },

    ownKeys(target) {
      const keys = Object.keys(shape);
      // Add typename field if it exists on the definition
      const typenameField = (def as ObjectDef | EntityDef).typenameField;
      if (typenameField && !keys.includes(typenameField)) {
        keys.push(typenameField);
      }
      // Add method keys
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
      const typenameField = (def as ObjectDef | EntityDef).typenameField;
      if (prop in shape || prop === typenameField) {
        return {
          enumerable: true,
          configurable: true,
        };
      }
      // Methods are non-enumerable (like regular object methods)
      if (methods && typeof prop === 'string' && prop in methods) {
        return {
          enumerable: false,
          configurable: true,
        };
      }
      return undefined;
    },
  };

  proxy = new Proxy<Record<string, unknown>>(
    {
      [CustomNodeInspect]: () => {
        return Object.keys(shape).reduce(
          (acc, key) => {
            acc[key] = proxy[key];
            return acc;
          },
          {} as Record<string, unknown>,
        );
      },
    } as Record<string, unknown>,
    handler,
  );

  // Add the proxy to the proxy brand set so we can easily identify it later
  PROXY_ID.set(proxy, id);

  // Associate the proxy with a scope owner for reactive method caching
  if (scopeOwner) {
    setScopeOwner(proxy, scopeOwner);
  }

  return proxy;
}

export function getProxyId(object: Record<string, unknown>): number | undefined {
  return PROXY_ID.get(object);
}
