import { typeError } from './errors.js';
import { getFormat } from './typeDefs.js';
import {
  ARRAY_KEY,
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  Mask,
  ObjectDef,
  RECORD_KEY,
  ObjectFieldTypeDef,
  UnionDef,
  TypeDef,
} from './types.js';
import { extractShape, typeMaskOf } from './utils.js';
import { PreloadedEntityRecord } from './EntityMap.js';

const entries = Object.entries;

const PROXY_BRAND = new WeakSet();

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
        return value;
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
  if (PROXY_BRAND.has(object)) {
    // Is an entity proxy, so return it directly
    return object;
  }

  const shape = extractShape(objectShape);

  for (const [key, propShape] of entries(shape)) {
    // parse and replace the property in place
    object[key] = parseValue(object[key], propShape, `${path}.${key}`);
  }

  return object;
}

export function parseValue(value: unknown, propDef: ObjectFieldTypeDef, path: string): unknown {
  // Handle Set-based constants/enums
  if (propDef instanceof Set) {
    if (!propDef.has(value as string | boolean | number)) {
      throw typeError(path, propDef as any, value);
    }
    return value;
  }

  switch (typeof propDef) {
    case 'string':
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

const CustomNodeInspect = Symbol.for('nodejs.util.inspect.custom');

export function createEntityProxy(
  id: number,
  entityRecord: PreloadedEntityRecord,
  def: ObjectDef | EntityDef,
  desc?: string,
): Record<string, unknown> {
  // Cache for nested proxies - each proxy gets its own cache
  const shape = extractShape(def);

  const toJSON = () => ({
    __entityRef: id,
  });

  const handler: ProxyHandler<any> = {
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

      let value = obj[prop as string];
      let propDef = shape[prop as string];

      if (!Object.hasOwnProperty.call(shape, prop)) {
        return value;
      }

      const parsed = parseValue(value, propDef, `[[${desc}]].${prop as string}`);

      cache.set(prop, parsed);

      return parsed;
    },

    has(target, prop) {
      return prop in shape;
    },

    ownKeys(target) {
      const keys = Object.keys(shape);
      // Add typename field if it exists on the definition
      const typenameField = (def as ObjectDef | EntityDef).typenameField;
      if (typenameField && !keys.includes(typenameField)) {
        keys.push(typenameField);
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
      return undefined;
    },
  };

  const proxy = new Proxy(
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
    },
    handler,
  );

  // Add the proxy to the proxy brand set so we can easily identify it later
  PROXY_BRAND.add(proxy);

  return proxy;
}
