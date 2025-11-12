const { log, floor, imul, abs } = Math;

function hashStr(key: string, seed = 0) {
  let h = seed ^ key.length;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let i = 0;
  while (i + 4 <= key.length) {
    let k =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);
    k = imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = imul(h, 5) + 0xe6546b64;
    i += 4;
  }
  let k = 0;
  switch (key.length & 3) {
    case 3:
      k ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    // eslint-disable-next-line no-fallthrough
    case 2:
      k ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    // eslint-disable-next-line no-fallthrough
    case 1:
      k ^= key.charCodeAt(i) & 0xff;
      k = imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = imul(k, c2);
      h ^= k;
  }
  h ^= key.length;
  h ^= h >>> 16;
  h = imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0; // Convert to unsigned 32-bit integer
}

function hashNumber(num: number, seed = 0) {
  // Handle negative numbers by taking absolute value
  num = abs(num);

  let h = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Process 4 bytes at a time
  while (num >= 0xffffffff) {
    // Extract the lowest 32 bits
    let k = num & 0xffffffff;
    num = floor(num / 0x100000000);

    k = imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = imul(k, c2);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = imul(h, 5) + 0xe6546b64;
  }

  // Process the remaining bytes (up to 4 bytes)
  if (num > 0) {
    let k = num & 0xffffffff;
    k = imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = imul(k, c2);
    h ^= k;
  }

  // Get the number of bytes in the original number
  const numBytes = num === 0 ? 1 : floor(log(num) / log(256)) + 1;

  h ^= numBytes;
  h ^= h >>> 16;
  h = imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0; // Convert to unsigned 32-bit integer
}

function hashArray(arr: unknown[]) {
  let h = HashType.ARRAY;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Process 4 bytes at a time
  for (const item of arr) {
    // Extract the lowest 32 bits
    let k = hashValue(item);

    k = imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = imul(k, c2);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = imul(h, 5) + 0xe6546b64;
  }

  h ^= arr.length;
  h ^= h >>> 16;
  h = imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0; // Convert to unsigned 32-bit integer
}

function hashObject(obj: object) {
  let sum = OBJECT;
  const keys = Object.keys(obj);

  for (const key of keys) {
    sum += hashValue(key) ^ hashValue((obj as any)[key]);
  }

  return sum >>> 0;
}

function hashSet(set: Set<unknown>) {
  let sum = HashType.SET;
  for (const value of set) {
    sum += hashValue(value);
  }
  return sum >>> 0;
}

function hashMap(map: Map<unknown, unknown>) {
  let sum = HashType.MAP;

  for (const [key, value] of map) {
    sum += hashValue(key) ^ hashValue(value);
  }

  return sum >>> 0;
}

function hashDate(date: Date) {
  return hashNumber(date.getTime(), HashType.DATE);
}

function hashRegExp(regexp: RegExp) {
  const h = hashStr(regexp.source + regexp.flags, HashType.REGEXP);
  return (h ^ regexp.lastIndex) >>> 0;
}

const enum HashType {
  UNDEFINED = 0,
  NULL = 1,
  TRUE = 2,
  FALSE = 3,
  NUMBER = 4,
  STRING = 5,
  BIGINT = 6,
  ARRAY = 7,
  OBJECT = 8,
  REFERENCE = 9,
  SYMBOL = 10,
  CYCLE = 11,
  MAP = 12,
  SET = 13,
  DATE = 14,
  REGEXP = 15,
}

const UNDEFINED = hashStr('undefined', HashType.UNDEFINED);
const NULL = hashStr('null', HashType.NULL);
const TRUE = hashStr('true', HashType.TRUE);
const FALSE = hashStr('false', HashType.FALSE);
const ARRAY = hashStr('array', HashType.ARRAY);
const OBJECT = hashStr('object', HashType.OBJECT);

const getObjectProto = Object.getPrototypeOf;

const PROTO_TO_HASH = new Map<object, (obj: any) => number>([
  [Object.prototype, hashObject],
  [Array.prototype, hashArray],
  [Map.prototype, hashMap],
  [Set.prototype, hashSet],
  [Date.prototype, hashDate],
  [RegExp.prototype, hashRegExp],
]);

export const registerCustomHash = <T>(ctor: { new (): T }, hashFn: (obj: T) => number) => {
  PROTO_TO_HASH.set(ctor.prototype, hashFn);
};

export function hashValue(node: unknown, seen: unknown[] = []) {
  switch (typeof node) {
    case 'undefined':
      return UNDEFINED;
    case 'boolean':
      return node ? TRUE : FALSE;
    case 'number':
      return hashStr(String(node), HashType.NUMBER);
    case 'string':
      return hashStr(node, HashType.STRING);
    case 'bigint':
      return hashStr(node.toString(), HashType.BIGINT);
    case 'object': {
      if (node === null) {
        return NULL;
      }

      const index = seen.indexOf(node);
      if (index !== -1) {
        return hashStr(String(index), HashType.CYCLE);
      }

      const hashFn = PROTO_TO_HASH.get(getObjectProto(node));

      if (hashFn) {
        seen.push(node);
        const hash = hashFn(node);
        seen.pop();
        return hash;
      }

      return getObjectHash(node);
    }
    case 'function':
      return getObjectHash(node);
    case 'symbol':
      return hashStr(node.toString(), HashType.SYMBOL);
  }
}

const objectToHashMap = new WeakMap<object, number>();
let nextHashMapId = 1;

export function getObjectHash(obj: object): number {
  let id = objectToHashMap.get(obj);
  if (id === undefined) {
    id = hashNumber(nextHashMapId++, HashType.REFERENCE);
    objectToHashMap.set(obj, id);
  }
  return id;
}

const EMPTY_ARRAY_HASH = hashArray([]);

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function hashReactiveFn(fn: Function, args: unknown[]) {
  return getObjectHash(fn) ^ (args.length > 0 ? hashArray(args) : EMPTY_ARRAY_HASH);
}
