import { Mask } from './types.js';

const isArray = Array.isArray;

export function typeMaskOf(value: unknown): Mask {
  if (value === null) return Mask.NULL;

  switch (typeof value) {
    case 'number':
      return Mask.NUMBER;
    case 'string':
      return Mask.STRING;
    case 'boolean':
      return Mask.BOOLEAN;
    case 'undefined':
      return Mask.UNDEFINED;
    case 'object':
      return isArray(value) ? Mask.ARRAY : Mask.OBJECT;
    default:
      throw new Error(`Invalid type: ${typeof value}`);
  }
}

// ================================
// Draft Helper Types
// ================================

/**
 * Recursively makes all properties of T mutable (removes readonly).
 * This is the return type of the draft() function.
 */
export type Draft<T> = T extends readonly (infer U)[]
  ? Draft<U>[]
  : T extends Date
    ? Date
    : T extends Map<infer K, infer V>
      ? Map<Draft<K>, Draft<V>>
      : T extends Set<infer U>
        ? Set<Draft<U>>
        : T extends object
          ? { -readonly [K in keyof T]: Draft<T[K]> }
          : T;

/**
 * Deep clones an entity or object, returning a plain mutable copy.
 * This is useful for creating a "draft" version of an entity that can be modified
 * before being passed to a mutation.
 *
 * The draft is a plain JavaScript object (not an entity proxy), so:
 * - All fields are mutable via property assignment
 * - Changes don't affect the original entity
 * - When passed to a mutation, it's serialized as a normal object
 *
 * @example
 * ```ts
 * // Get an entity from a query
 * const user = await getUser({ id: '123' });
 *
 * // Create a draft to modify
 * const updatedUser = draft(user);
 * updatedUser.name = 'New Name';
 * updatedUser.email = 'new@example.com';
 *
 * // Pass to mutation
 * await updateUser().run(updatedUser);
 * ```
 *
 * @param entity - The entity or object to clone
 * @returns A deep clone of the entity as a plain mutable object
 */
export function draft<T>(entity: T): Draft<T> {
  return deepClone(entity) as Draft<T>;
}

/**
 * Deep clones a value, handling objects, arrays, and primitives.
 * Entity proxies are converted to plain objects by reading all enumerable properties.
 */
function deepClone<T>(value: T): T {
  // Handle null and primitives
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Handle arrays
  if (isArray(value)) {
    return value.map(item => deepClone(item)) as T;
  }

  // Handle Date objects
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  // Handle Map
  if (value instanceof Map) {
    const clonedMap = new Map();
    for (const [k, v] of value) {
      clonedMap.set(deepClone(k), deepClone(v));
    }
    return clonedMap as T;
  }

  // Handle Set
  if (value instanceof Set) {
    const clonedSet = new Set();
    for (const v of value) {
      clonedSet.add(deepClone(v));
    }
    return clonedSet as T;
  }

  // Handle plain objects (including entity proxies)
  // For entity proxies, reading properties will extract the underlying data
  const result: Record<string, unknown> = {};

  // Get all enumerable own properties (works for both plain objects and proxies)
  for (const key of Object.keys(value as object)) {
    result[key] = deepClone((value as Record<string, unknown>)[key]);
  }

  return result as T;
}
