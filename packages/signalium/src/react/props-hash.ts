import {
  ARRAY_SEED,
  finalizeHash,
  getObjectHash,
  hashObjectKeys,
  hashValue,
  mixHash,
} from '../internals/utils/hash.js';

const { imul } = Math;
const { getPrototypeOf, keys: objectKeys } = Object;

const EMPTY_PROPS_HASH = hashValue({});

/**
 * React elements are plain object literals, so `hashValue` hashes them
 * structurally: it walks `props` and recurses through the entire children tree.
 * For a component taking `children`, that walk dominates every render. An
 * element is opaque — nothing reads through it — so hash it by identity. Every
 * other prop keeps its structural hash, so a new-but-equivalent object or array
 * still reuses the memo.
 *
 * The value may be a proxy, whose traps can throw or subscribe the renderer to
 * whatever they touch. So `$$typeof` is only read when it is an own enumerable
 * key, which the structural hash reads anyway, and the keys are reused for it.
 */
function hashPropValue(value: unknown, seen: unknown[]): number {
  if (typeof value === 'object' && value !== null) {
    const proto = getPrototypeOf(value);

    if (proto === Object.prototype) {
      const keys = objectKeys(value);
      if (keys.includes('$$typeof') && typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol') {
        return getObjectHash(value);
      }
      seen.push(value);
      const h = hashObjectKeys(value, keys, seen);
      seen.pop();
      return h;
    }

    // Plain arrays only: an `Array` subclass hashes like any other class instance
    // in `hashValue`, by its `registerCustomHash` function or else by identity.
    if (proto === Array.prototype) {
      // `children` is commonly an array, and elements inside it need the same
      // treatment. Order-sensitive, so a reorder still changes the hash.
      if (seen.includes(value)) return 0;
      seen.push(value);
      const array = value as unknown[];
      let h = ARRAY_SEED;
      for (let i = 0; i < array.length; i++) {
        h = mixHash(h, hashPropValue(array[i], seen));
      }
      seen.pop();
      return finalizeHash(h, array.length);
    }
  }

  return hashValue(value, seen);
}

/** `hashValue(props)`, except React elements are hashed by identity. */
export function hashProps(props: object): number {
  const keyMultiplier = 0x9e3779b9; // 2^32 / golden ratio, as in `hashObjectKeys`
  const seen: unknown[] = [];
  let sum = EMPTY_PROPS_HASH;
  for (const key of objectKeys(props)) {
    sum += imul(hashValue(key), keyMultiplier) ^ hashPropValue((props as Record<string, unknown>)[key], seen);
  }
  return sum >>> 0;
}
