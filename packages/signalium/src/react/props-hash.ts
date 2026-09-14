import { getObjectHash, hashValue } from '../internals/utils/hash.js';

const { imul } = Math;
const { getPrototypeOf } = Object;

const EMPTY_PROPS_HASH = hashValue({});

/**
 * React elements are plain object literals, so `hashValue` hashes them
 * structurally: it walks `props` and recurses through the entire children tree.
 * For a component taking `children`, that walk dominates every render. An
 * element is opaque — nothing reads through it — so hash it by identity. Every
 * other prop keeps its structural hash, so a new-but-equivalent object or array
 * still reuses the memo.
 *
 * The plain-object guard is load-bearing, not a fast path: reading `$$typeof`
 * off an arbitrary value can run a proxy trap with side effects, and a reactive
 * one would subscribe the renderer to whatever it touched. Elements are always
 * plain objects, so nothing else is ever read.
 */
function isElement(value: object): boolean {
  return getPrototypeOf(value) === Object.prototype && typeof (value as { $$typeof?: unknown }).$$typeof === 'symbol';
}

function hashPropValue(value: unknown, seen: unknown[]): number {
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      // `children` is commonly an array, and elements inside it need the same
      // treatment. Order-sensitive, so a reorder still changes the hash.
      if (seen.includes(value)) return 0;
      seen.push(value);
      let h = (0x9e3779b9 ^ value.length) >>> 0;
      for (let i = 0; i < value.length; i++) {
        h = (imul(h, 31) + hashPropValue(value[i], seen)) >>> 0;
      }
      seen.pop();
      return h;
    }
    if (isElement(value)) return getObjectHash(value);
  }

  return hashValue(value);
}

/** `hashValue(props)`, except React elements are hashed by identity. */
export function hashProps(props: object): number {
  const seen: unknown[] = [];
  let sum = EMPTY_PROPS_HASH;
  for (const key of Object.keys(props)) {
    sum += imul(hashValue(key), 0x9e3779b9) ^ hashPropValue((props as Record<string, unknown>)[key], seen);
  }
  return sum >>> 0;
}
