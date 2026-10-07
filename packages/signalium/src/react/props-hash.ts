import { useRef } from 'react';
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

/**
 * True when `next` has exactly the same keys as `prev` and every value is the same by `Object.is`.
 * Iterates with `for...in` (props are plain objects with no enumerable inherited keys) so the check
 * allocates nothing.
 */
function shallowIdentical(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  let count = 0;

  for (const key in next) {
    if (!Object.is(prev[key], next[key]) || !(key in prev)) return false;
    count++;
  }

  for (const _key in prev) {
    count--;
  }

  return count === 0;
}

class PropsHashCache {
  constructor(
    public props: object,
    public hash: number,
  ) {}
}

/**
 * `hashProps(props)` for a component wrapper, skipping the hash when every prop is identical (by
 * `Object.is`) to the previous render's. A parent that re-renders without changing any prop —
 * by far the common case — then costs one shallow comparison instead of a structural hash.
 *
 * Props are treated as immutable, the same contract as `React.memo` and the React Compiler: a
 * plain object, array, `Map`, `Set` or `Date` prop mutated in place and passed again under the
 * same identity keeps its previous hash, so the memoized element is reused and the component
 * does not re-render for it. (Structural hashing used to notice such mutations, because those
 * values are hashed by content; reference-hashed values — class instances, functions, elements —
 * never could.) Pass a new object, or read the changing data from a signal inside the
 * component, instead of mutating a prop in place.
 *
 * The cache holds only the props a render already hashed, so a render React discards can at most
 * leave a correct (props → hash) pair behind.
 */
export function usePropsHash(props: object): number {
  const ref = useRef<PropsHashCache | null>(null);
  const cache = ref.current;

  if (cache !== null) {
    if (
      cache.props === props ||
      shallowIdentical(cache.props as Record<string, unknown>, props as Record<string, unknown>)
    ) {
      return cache.hash;
    }

    const hash = hashProps(props);
    cache.props = props;
    cache.hash = hash;
    return hash;
  }

  const hash = hashProps(props);
  ref.current = new PropsHashCache(props, hash);
  return hash;
}
