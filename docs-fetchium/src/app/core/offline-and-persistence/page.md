---
title: Offline & Persistence
---

Fetchium has built-in support for offline operation and query persistence. It can detect network status, pause queries when the device goes offline, and persist query results across sessions so your application works even without a connection.

---

## Overview

Three systems work together to provide offline and persistence support:

1. **NetworkManager** -- detects online/offline status and exposes it as a reactive signal
2. **QueryStore** -- persists query results and entity data to a backing store
3. **GcManager** -- evicts unused queries and entities from the in-memory cache to control memory usage

All three are passed to the `QueryClient` constructor, and each has a no-op variant for environments where the capability is not needed (such as server-side rendering).

---

## Network Manager

The `NetworkManager` tracks whether the device is online or offline. It automatically listens to browser `online` and `offline` events, and exposes the current status as a reactive signal so that queries can pause and resume automatically.

### Basic usage

```tsx
import { NetworkManager } from 'fetchium';

const networkManager = new NetworkManager();
// Automatically detects browser online/offline events
```

The network manager is passed to the `QueryClient` constructor:

```tsx
import { QueryClient } from 'fetchium';
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';

const store = new SyncQueryStore(new MemoryPersistentStore());
const networkManager = new NetworkManager();

const client = new QueryClient(store, { fetch }, networkManager);
```

If you do not provide a `NetworkManager`, the `QueryClient` creates one automatically.

### Manual override

For testing or custom scenarios, you can manually override the network status:

```tsx
// Force the app into offline mode
networkManager.setNetworkStatus(false);

// Force the app back online
networkManager.setNetworkStatus(true);

// Clear the override and return to automatic detection
networkManager.clearManualOverride();
```

When a manual override is active, the browser's actual connectivity events are ignored.

### Reactive signal

The network manager exposes its status as a reactive signal. You can read it directly in reactive functions:

```tsx
const onlineSignal = networkManager.getOnlineSignal();
// Reading onlineSignal.value in a reactive context
// will re-evaluate when connectivity changes
```

### Cleanup

When you are done with a network manager, call `destroy()` to remove its event listeners:

```tsx
networkManager.destroy();
```

---

## Network Modes

Each query can configure how it behaves when the device is offline. Set `networkMode` in the query's `config` property:

```tsx
import { RESTQuery, t, NetworkMode } from 'fetchium';

class GetUser extends RESTQuery {
  params = { id: t.id };
  path = `/users/${this.params.id}`;
  result = { id: t.id, name: t.string };

  config = {
    networkMode: NetworkMode.OfflineFirst,
  };
}
```

There are three network modes:

### `NetworkMode.Online` (default)

The query only fetches when the device is online. If the device goes offline while a query is active, the query pauses and resumes automatically when connectivity is restored.

This is the safest default -- it prevents failed requests and unnecessary retries while offline.

### `NetworkMode.Always`

The query fetches regardless of network status. Use this when you have a local server, service worker, or other mechanism that can handle requests even without internet access.

```tsx
config = {
  networkMode: NetworkMode.Always,
};
```

### `NetworkMode.OfflineFirst`

If cached data exists, the query returns it immediately even when offline. When the device comes back online, the query refetches to get fresh data (assuming the data is stale).

This mode is ideal for applications that need to show something to the user even when there is no connection.

```tsx
config = {
  networkMode: NetworkMode.OfflineFirst,
};
```

{% callout %}
When using `NetworkMode.OfflineFirst`, pair it with a `QueryStore` that persists data across sessions. Otherwise, the cache will be empty on a fresh app launch and there will be nothing to show while offline.
{% /callout %}

### Refetch on reconnect

By default, queries with `NetworkMode.Online` or `NetworkMode.OfflineFirst` refetch stale data when the device reconnects. You can disable this behavior:

```tsx
config = {
  networkMode: NetworkMode.Online,
  refreshStaleOnReconnect: false,
};
```

---

## Query Stores

A query store is responsible for persisting query results and entity data. Fetchium provides two implementations: a synchronous store for in-memory or localStorage-style backends, and an asynchronous store for IndexedDB, AsyncStorage, or cross-worker architectures.

### SyncQueryStore

The `SyncQueryStore` wraps a synchronous key-value store. It is the simplest option and works well for most applications.

```tsx
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';

const store = new SyncQueryStore(new MemoryPersistentStore());
const client = new QueryClient(store, { fetch });
```

The `MemoryPersistentStore` keeps everything in memory -- data is lost when the page is refreshed. For persistence across sessions, implement the `SyncPersistentStore` interface with a durable backend like `localStorage`.

### AsyncQueryStore

The `AsyncQueryStore` is designed for asynchronous storage backends such as IndexedDB or React Native's AsyncStorage. It uses a writer-reader architecture where one instance (the writer) owns the backing store, and other instances (readers) communicate with it via messages.

```tsx
import { AsyncQueryStore } from 'fetchium/stores/async';

const store = new AsyncQueryStore({
  isWriter: true,
  connect: (handleMessage) => ({
    sendMessage: (msg) => handleMessage(msg),
  }),
  delegate: myAsyncPersistentStore,
});
```

The `connect` function establishes a communication channel. For a single-threaded application, you can loop messages back directly as shown above. For cross-worker scenarios, wire `sendMessage` and `handleMessage` through `postMessage` / `onmessage`.

**Writer vs reader:**

- The **writer** (`isWriter: true`) is the only instance that writes to the backing store. It must be provided a `delegate` (an `AsyncPersistentStore` implementation).
- **Readers** (`isWriter: false`) send write operations to the writer via messages and can load data directly from their own delegate (if provided).

This architecture ensures serialized writes even when multiple tabs or workers are involved.

---

## The SyncPersistentStore Interface

To build a custom synchronous persistence backend, implement the `SyncPersistentStore` interface:

```tsx
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

The store needs to handle three data types: strings (for serialized JSON values), numbers (for timestamps and reference counts), and `Uint32Array` buffers (for entity ID sets and LRU queues).

### Example: localStorage adapter

```tsx
class LocalStoragePersistentStore implements SyncPersistentStore {
  has(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  getString(key: string): string | undefined {
    return localStorage.getItem(key) ?? undefined;
  }

  setString(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  getNumber(key: string): number | undefined {
    const v = localStorage.getItem(key);
    return v !== null ? Number(v) : undefined;
  }

  setNumber(key: string, value: number): void {
    localStorage.setItem(key, String(value));
  }

  getBuffer(key: string): Uint32Array | undefined {
    const v = localStorage.getItem(key);
    if (v === null) return undefined;
    return new Uint32Array(JSON.parse(v));
  }

  setBuffer(key: string, value: Uint32Array): void {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
  }

  delete(key: string): void {
    localStorage.removeItem(key);
  }

  getAllKeys(): string[] {
    return Object.keys(localStorage);
  }
}
```

{% callout type="warning" %}
`localStorage` has a 5 MB limit in most browsers. For larger datasets, consider using IndexedDB via the `AsyncQueryStore` instead.
{% /callout %}

### The AsyncPersistentStore Interface

The async counterpart has the same methods, but each returns a `Promise`:

```tsx
interface AsyncPersistentStore {
  has(key: string): Promise<boolean>;

  getString(key: string): Promise<string | undefined>;
  setString(key: string, value: string): Promise<void>;

  getNumber(key: string): Promise<number | undefined>;
  setNumber(key: string, value: number): Promise<void>;

  getBuffer(key: string): Promise<Uint32Array | undefined>;
  setBuffer(key: string, value: Uint32Array): Promise<void>;

  delete(key: string): Promise<void>;

  getAllKeys(): Promise<string[]>;
}
```

---

## Garbage Collection

The `GcManager` handles eviction of queries and entities from the in-memory cache when they are no longer being watched by any component or watcher.

### How it works

When a query or entity loses all of its active subscribers (no components are rendering it, no watchers are observing it), it becomes eligible for garbage collection. The `GcManager` uses a bucket-based eviction system:

1. When a query becomes unwatched, it is scheduled for eviction based on its `gcTime`
2. If the query is re-watched before the timer fires, eviction is cancelled
3. When the timer fires, the query is removed from the in-memory cache

### Configuring gcTime

The `gcTime` is configured per-query in the `cache` options:

```tsx
class GetUser extends RESTQuery {
  params = { id: t.id };
  path = `/users/${this.params.id}`;
  result = { id: t.id, name: t.string };

  cache = {
    gcTime: 5, // evict after 5-10 minutes of being unwatched
  };
}
```

The `gcTime` value is specified in **minutes**. Due to the bucket-based system, actual eviction happens between `gcTime` and `2 * gcTime` after the query becomes unwatched.

| gcTime value | Behavior                                                           |
| ------------ | ------------------------------------------------------------------ |
| `0`          | Evict on the next microtask (immediately after becoming unwatched) |
| `5`          | Evict between 5 and 10 minutes after becoming unwatched            |
| `Infinity`   | Never evict -- the query stays in memory forever                   |

### GcManager setup

The `GcManager` is typically created automatically by the `QueryClient`. You only need to create one manually if you want custom behavior:

```tsx
import { GcManager } from 'fetchium';

const gcManager = new GcManager(
  (key, type) => {
    // Called when a key is evicted
    // type is GcKeyType.Query or GcKeyType.Entity
  },
  1, // multiplier (default: 1)
);

const client = new QueryClient(store, { fetch }, networkManager, gcManager);
```

The second parameter is a `multiplier` that scales all gc intervals. This is useful in tests to speed up eviction.

### Disabling garbage collection

Use `NoOpGcManager` to disable garbage collection entirely:

```tsx
import { NoOpGcManager } from 'fetchium';

const client = new QueryClient(
  store,
  { fetch },
  networkManager,
  new NoOpGcManager(),
);
```

This is useful for server-side rendering or test environments where you do not want background timers.

---

## Cache Time vs GC Time

It is important to understand the difference between `cacheTime` and `gcTime`:

| Option      | Controls                                                                | Unit    | Default |
| ----------- | ----------------------------------------------------------------------- | ------- | ------- |
| `cacheTime` | How long persisted data is considered valid when loading from the store | Minutes | 60      |
| `gcTime`    | How long an unwatched query stays in the in-memory cache                | Minutes | 5       |

When a query is loaded from the persistent store (`SyncQueryStore` or `AsyncQueryStore`), the `cacheTime` determines whether the persisted data is still fresh enough to use. If the data is older than `cacheTime`, it is discarded and the query fetches fresh data from the network.

The `gcTime` only affects the in-memory cache. Even after a query is garbage-collected from memory, its data may still exist in the persistent store and can be reloaded later.

---

## Stale query purging

Both `SyncQueryStore` and `AsyncQueryStore` support purging stale queries from the persistent store:

```tsx
store.purgeStaleQueries();
```

This scans all persisted query definitions and removes any whose `lastUsedAt` timestamp is older than their `cacheTime`. The `QueryClient` calls this automatically on construction.

---

## Server-Side Rendering

When running on the server (detected by `typeof window === 'undefined'`), the `QueryClient` adjusts its defaults:

- **Retry defaults to 0** -- server requests should not retry, as this would block the response
- **GcManager is replaced with `NoOpGcManager`** -- there are no long-lived subscriptions on the server, so garbage collection is unnecessary
- **NetworkManager is created normally** but defaults to `isOnline = true` since there is no browser API to detect connectivity

For explicit SSR setups, you can use the no-op variants directly:

```tsx
import { QueryClient } from 'fetchium';
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';
import { NoOpNetworkManager } from 'fetchium';
import { NoOpGcManager } from 'fetchium';

const store = new SyncQueryStore(new MemoryPersistentStore());
const client = new QueryClient(
  store,
  { fetch },
  new NoOpNetworkManager(),
  new NoOpGcManager(),
);
```

The `NoOpNetworkManager` always reports `isOnline = true` and ignores any calls to `setNetworkStatus()` or `clearManualOverride()`. This prevents unnecessary event listener registration in a server environment.

{% callout %}
On the server, prefer `SyncQueryStore` with `MemoryPersistentStore` over `AsyncQueryStore`. Async stores add complexity that is not needed for short-lived server requests.
{% /callout %}

---

## Putting It All Together

Here is a complete example that sets up a `QueryClient` with persistence, network awareness, and garbage collection:

```tsx
import { QueryClient, NetworkManager } from 'fetchium';
import { SyncQueryStore } from 'fetchium/stores/sync';
import { GcManager, NoOpGcManager } from 'fetchium';

// Use a localStorage-backed store for persistence across sessions
const store = new SyncQueryStore(new LocalStoragePersistentStore());

// Automatically detect network status
const networkManager = new NetworkManager();

// Standard GC with default settings
const isServer = typeof window === 'undefined';
const gcManager = isServer
  ? new NoOpGcManager()
  : new GcManager((key, type) => client.evict(key, type));

const client = new QueryClient(store, { fetch }, networkManager, gcManager);
```

With this setup:

- Query results are persisted to `localStorage` and survive page refreshes
- Queries automatically pause when the device goes offline and resume when it reconnects
- Unused queries are evicted from memory after their `gcTime` expires, but their persisted data remains in `localStorage` for the next session
