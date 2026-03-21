---
title: fetchium/stores/sync
description: API reference for the synchronous query store.
---

# fetchium/stores/sync

Synchronous query store implementation for Fetchium. Provides in-memory and pluggable persistent storage with LRU cache eviction and reference-counted entity cleanup.

```ts
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';
import type { SyncPersistentStore } from 'fetchium/stores/sync';
```

---

## Classes

### `SyncQueryStore`

Implements the `QueryStore` interface using a synchronous key-value backend. Manages an LRU queue per query class and automatically evicts the oldest entries when the queue exceeds `maxCount`. Entity data is reference-counted; entities are cascade-deleted when their reference count reaches zero.

#### Constructor

```ts
new SyncQueryStore(kv: SyncPersistentStore)
```

| Parameter | Type                  | Description                                 |
| --------- | --------------------- | ------------------------------------------- |
| `kv`      | `SyncPersistentStore` | The underlying synchronous key-value store. |

#### Methods

| Method              | Signature                                                                                                      | Description                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadQuery`         | `(queryDef: QueryDefinition, queryKey: number): CachedQuery \| undefined`                                      | Loads a cached query by key. Returns `undefined` if the cache entry has expired (beyond `cacheTime`) or does not exist. Also preloads referenced entities. |
| `saveQuery`         | `(queryDef: QueryDefinition, queryKey: number, value: unknown, updatedAt: number, refIds?: Set<number>): void` | Persists a query result, its timestamp, and entity reference IDs. Activates the query in the LRU queue.                                                    |
| `saveEntity`        | `(entityKey: number, value: unknown, refIds?: Set<number>): void`                                              | Persists an entity's serialized data and its child entity references. Manages reference counts for nested entities.                                        |
| `activateQuery`     | `(queryDef: QueryDefinition, queryKey: number): void`                                                          | Moves a query to the front of the LRU queue for its query class. If the queue is full, the oldest entry is evicted.                                        |
| `deleteQuery`       | `(queryKey: number): void`                                                                                     | Deletes a query's stored value, reference IDs, and decrements reference counts for all referenced entities.                                                |
| `purgeStaleQueries` | `(): void`                                                                                                     | Scans all query classes and removes those whose `lastUsedAt` timestamp exceeds their `cacheTime`. Called automatically on `QueryClient` construction.      |

---

### `MemoryPersistentStore`

In-memory implementation of `SyncPersistentStore`. Stores all data in a plain JavaScript object. Suitable for development, testing, and applications that do not need persistence across sessions.

#### Constructor

```ts
new MemoryPersistentStore();
```

No parameters. Creates an empty store.

#### Methods

Implements all methods of `SyncPersistentStore` (see interface below).

---

## Interfaces

### `SyncPersistentStore`

The interface for synchronous key-value storage backends. Implement this to plug in custom storage (e.g., `localStorage`, synchronous SQLite, shared memory).

```ts
interface SyncPersistentStore {
  has(key: string): boolean;

  getString(key: string): string | undefined;
  setString(key: string, value: string): void;

  getNumber(key: string): number | undefined;
  setNumber(key: string, value: number): void;

  getBuffer(key: string): Uint32Array | undefined;
  setBuffer(key: string, value: Uint32Array): void;

  delete(key: string): void;

  getAllKeys(): string[];
}
```

| Method       | Signature                                 | Description                                                                                 |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `has`        | `(key: string): boolean`                  | Returns `true` if the key exists in the store.                                              |
| `getString`  | `(key: string): string \| undefined`      | Retrieves a string value by key.                                                            |
| `setString`  | `(key: string, value: string): void`      | Stores a string value.                                                                      |
| `getNumber`  | `(key: string): number \| undefined`      | Retrieves a numeric value by key.                                                           |
| `setNumber`  | `(key: string, value: number): void`      | Stores a numeric value.                                                                     |
| `getBuffer`  | `(key: string): Uint32Array \| undefined` | Retrieves a `Uint32Array` buffer by key. Used for LRU queues and entity reference ID lists. |
| `setBuffer`  | `(key: string, value: Uint32Array): void` | Stores a `Uint32Array` buffer.                                                              |
| `delete`     | `(key: string): void`                     | Deletes a key and its associated value.                                                     |
| `getAllKeys` | `(): string[]`                            | Returns all keys in the store. Used by `purgeStaleQueries` to scan for expired entries.     |

---

## Storage key layout

Internally, `SyncQueryStore` uses the following key prefixes in the underlying `SyncPersistentStore`:

| Prefix / Pattern  | Value type    | Description                                         |
| ----------------- | ------------- | --------------------------------------------------- |
| `v:{id}`          | `string`      | JSON-serialized value for a query or entity.        |
| `u:{id}`          | `number`      | `updatedAt` timestamp (ms since epoch) for a query. |
| `r:{id}`          | `Uint32Array` | Entity reference IDs for a query or entity.         |
| `rc:{id}`         | `number`      | Reference count for an entity.                      |
| `q:{queryDefId}`  | `Uint32Array` | LRU queue buffer for a query class.                 |
| `lu:{queryDefId}` | `number`      | Last-used timestamp for a query class.              |
| `ct:{queryDefId}` | `number`      | Cache time (minutes) for a query class.             |

---

## Example

```ts
import { QueryClient } from 'fetchium';
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';

// Create an in-memory store
const store = new SyncQueryStore(new MemoryPersistentStore());

// Create the query client
const client = new QueryClient(store, {
  fetch: globalThis.fetch,
  baseUrl: 'https://api.example.com',
});
```
