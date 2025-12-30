import { reactiveMethod, setScopeOwner } from 'signalium';
import { typeError } from './errors.js';
import { CaseInsensitiveSet, getFormat, ValidatorDef } from './typeDefs.js';
import {
  ARRAY_KEY,
  ComplexTypeDef,
  EntityDef,
  Mask,
  ObjectDef,
  RECORD_KEY,
  ObjectFieldTypeDef,
  UnionDef,
  TypeDef,
  RecordDef,
} from './types.js';
import { typeMaskOf } from './utils.js';
import { PreloadedEntityRecord } from './EntityMap.js';

export type WarnFn = (message: string, context?: Record<string, unknown>) => void;
const noopWarn: WarnFn = () => {};

const entries = Object.entries;
const isArray = Array.isArray;

const PROXY_ID = new WeakMap();

// Placeholder class used as the prototype for entity proxies.
// This prevents them from being treated as plain objects in utilities like `hashValue()`.
export class Entity {}

function parseUnionValue(
  valueType: number,
  value: Record<string, unknown> | unknown[],
  unionDef: UnionDef,
  path: string,
  warn: WarnFn = noopWarn,
): unknown {
  if (valueType === Mask.ARRAY) {
    const shape = unionDef.shape![ARRAY_KEY];

    if (shape === undefined || typeof shape === 'number') {
      return value;
    }

    return parseArrayValue(value as unknown[], shape, path, warn);
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

      return parseRecordValue(value as Record<string, unknown>, recordShape as ComplexTypeDef, path, warn);
    }

    const matchingDef = unionDef.shape![typename];

    if (matchingDef === undefined || typeof matchingDef === 'number') {
      throw new Error(`Unknown typename '${typename}' in union`);
    }

    return parseObjectValue(value as Record<string, unknown>, matchingDef as ObjectDef | EntityDef, path, warn);
  }
}

export function parseArrayValue(array: unknown[], arrayShape: TypeDef, path: string, warn: WarnFn = noopWarn) {
  const result: unknown[] = [];

  for (let i = 0; i < array.length; i++) {
    try {
      result.push(parseValue(array[i], arrayShape, `${path}[${i}]`, false, warn));
    } catch (e) {
      warn('Failed to parse array item, filtering out', {
        index: i,
        value: array[i],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export function parseRecordValue(
  record: Record<string, unknown>,
  recordShape: ObjectFieldTypeDef,
  path: string,
  warn: WarnFn = noopWarn,
) {
  for (const [key, value] of entries(record)) {
    record[key] = parseValue(value, recordShape, `${path}["${key}"]`, false, warn);
  }

  return record;
}

export function parseObjectValue(
  object: Record<string, unknown>,
  objectShape: ObjectDef | EntityDef,
  path: string,
  warn: WarnFn = noopWarn,
) {
  if (PROXY_ID.has(object)) {
    // Is an entity proxy, so return it directly
    return object;
  }

  const shape = objectShape.shape;

  for (const [key, propShape] of entries(shape)) {
    // parse and replace the property in place
    object[key] = parseValue(object[key], propShape, `${path}.${key}`, false, warn);
  }

  return object;
}

export function parseValue(
  value: unknown,
  propDef: ObjectFieldTypeDef,
  path: string,
  skipFallbacks = false,
  warn: WarnFn = noopWarn,
): unknown {
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
        if (!skipFallbacks && (propDef & Mask.UNDEFINED) !== 0) {
          warn('Invalid value for optional type, defaulting to undefined', { value, path });
          return undefined;
        }
        throw typeError(path, propDef, value);
      }

      // Check if this field has a format - if so, parse with the format parser
      if ((propDef & (Mask.HAS_STRING_FORMAT | Mask.HAS_NUMBER_FORMAT)) !== 0) {
        // Lazy format parsing: parse the raw value using the format parser
        try {
          return getFormat(propDef)(value);
        } catch (e) {
          if (!skipFallbacks && (propDef & Mask.UNDEFINED) !== 0) {
            warn('Invalid formatted value for optional type, defaulting to undefined', {
              value,
              path,
              error: e instanceof Error ? e.message : String(e),
            });
            return undefined;
          }
          throw e;
        }
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

      // Handle parseResult wrapper - wraps parsing in try-catch and returns discriminated union
      // Pass skipFallbacks=true so errors are thrown instead of defaulting to undefined
      if ((propMask & Mask.PARSE_RESULT) !== 0) {
        try {
          const innerResult = parseValue(value, propDef.shape as ObjectFieldTypeDef, path, true, warn);
          return { success: true as const, value: innerResult };
        } catch (e) {
          return { success: false as const, error: e instanceof Error ? e : new Error(String(e)) };
        }
      }

      // Check if the value type is allowed by the propMask
      // Also check if it's in a values set (for enums/constants stored in ValidatorDef)
      if ((propMask & valueType) === 0 && !propDef.values?.has(value as string | boolean | number)) {
        if (!skipFallbacks && (propMask & Mask.UNDEFINED) !== 0) {
          warn('Invalid value for optional type, defaulting to undefined', { value, path });
          return undefined;
        }
        throw typeError(path, propMask, value);
      }

      if (valueType < Mask.OBJECT) {
        // Check if this field has a format - if so, parse with the format parser
        if ((propMask & (Mask.HAS_STRING_FORMAT | Mask.HAS_NUMBER_FORMAT)) !== 0) {
          try {
            return getFormat(propMask)(value);
          } catch (e) {
            if (!skipFallbacks && (propMask & Mask.UNDEFINED) !== 0) {
              warn('Invalid formatted value for optional type, defaulting to undefined', {
                value,
                path,
                error: e instanceof Error ? e.message : String(e),
              });
              return undefined;
            }
            throw e;
          }
        }

        // value is a primitive, it has already passed the mask so return it now
        return value;
      }

      if ((valueType & Mask.UNION) !== 0) {
        return parseUnionValue(
          valueType,
          value as Record<string, unknown> | unknown[],
          propDef as UnionDef,
          path,
          warn,
        );
      }

      if (valueType === Mask.ARRAY) {
        return parseArrayValue(value as unknown[], propDef.shape as ComplexTypeDef, path, warn);
      }

      if ((propMask & Mask.RECORD) !== 0) {
        return parseRecordValue(value as Record<string, unknown>, (propDef as RecordDef).shape, path, warn);
      }

      return parseObjectValue(value as Record<string, unknown>, propDef as ObjectDef | EntityDef, path, warn);
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
    const targetValue = target[key];
    // Only merge if both value and targetValue are plain objects (not arrays or proxies)
    if (
      typeof value === 'object' &&
      value !== null &&
      !isArray(value) &&
      !PROXY_ID.has(value) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !isArray(targetValue) &&
      !PROXY_ID.has(targetValue)
    ) {
      mergeValues(targetValue as Record<string, unknown>, value as Record<string, unknown>);
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
  entityRelay: any,
  scopeOwner: object,
  warn: WarnFn = noopWarn,
  desc?: string,
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
    getPrototypeOf() {
      return Entity.prototype;
    },

    get(target, prop) {
      // Handle toJSON for serialization
      if (prop === 'toJSON') {
        return toJSON;
      }

      const { data, cache, notifier } = entityRecord;

      // Access relay value if it exists - this will activate it when watched in reactive context
      // The relay access happens here to establish tracking when signal.value is read
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      entityRelay?.value;

      notifier.consume();

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

      const value = data[prop as string];
      const propDef = shape[prop as string];

      if (!Object.hasOwnProperty.call(shape, prop)) {
        return value;
      }

      const parsed = parseValue(value, propDef, `[[${desc}]].${prop as string}`, false, warn);

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
  setScopeOwner(proxy, scopeOwner);

  return proxy;
}

export function getProxyId(object: Record<string, unknown>): number | undefined {
  return PROXY_ID.get(object);
}
