---
title: signalium/utils
nextjs:
  metadata:
    title: signalium/utils API
    description: Utilities API
---

## Functions

### hashValue

```ts
export function hashValue(value: unknown): number;
```

Stable hash for arbitrary values. Values are hashed semi-deeply, meaning that objects are hashed by their properties, arrays are hashed by their items, and so on, but only if they are plain objects or arrays. Class instances are hashed by reference by default, but you can override this behavior by providing a custom hash function using `registerCustomHash`.

| Parameter | Type      | Description   |
| --------- | --------- | ------------- |
| value     | `unknown` | Value to hash |

### registerCustomHash

```ts
export function registerCustomHash<T>(
  ctor: { new (): T },
  hashFn: (obj: T) => number,
): void;
```

Provide a custom hash for a prototype. This is useful for hashing class instances, which are hashed by reference by default.

| Parameter | Type                 | Description                               |
| --------- | -------------------- | ----------------------------------------- |
| ctor      | `{ new(): T }`       | Constructor whose prototype gets the hash |
| hashFn    | `(obj: T) => number` | Hash function                             |
