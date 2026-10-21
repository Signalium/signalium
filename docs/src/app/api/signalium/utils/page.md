---
title: signalium/utils
nextjs:
  metadata:
    title: signalium/utils API
    description: Utilities API
---

## Functions

### watchOnce

```ts
export function watchOnce<T>(fn: () => T): T;
```

Run a function in a watched reactive context. This activates its relays without subscribing to later updates.

Synchronous values return immediately. Synchronous errors are rethrown. Asynchronous results return a native promise with the same fulfillment value or rejection reason. The watcher stays strongly retained until the operation fulfills or rejects, then releases its watch. Relay deactivation follows the configured scheduler and waits for other watchers to release their watches.

There is no timeout or cancellation option. An operation that never settles keeps its watcher and dependencies retained. Ignoring the result or timing out a separate `Promise.race` does not release the watch. Bound the underlying work when an operation can be abandoned.

```ts
import { watchOnce } from 'signalium/utils';

const account = await watchOnce(() => getSelectedAccount());
```

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
export function registerCustomHash<T>(ctor: { new (): T }, hashFn: (obj: T) => number): void;
```

Provide a custom hash for a prototype. This is useful for hashing class instances, which are hashed by reference by default.

| Parameter | Type                 | Description                               |
| --------- | -------------------- | ----------------------------------------- |
| ctor      | `{ new(): T }`       | Constructor whose prototype gets the hash |
| hashFn    | `(obj: T) => number` | Hash function                             |
