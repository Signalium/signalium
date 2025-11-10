# @signalium/query

A reactive query client built on [Signalium](https://signalium.dev) that provides powerful data fetching, caching, and entity management with automatic reactivity.

## IMPORTANT NOTE: This package is still in development and the API is subject to change.

v1.0.0 was published prematurely and we are not treating it as the stable v1 release from a semver perspective. APIs are not expected to change dramatically, but breaking changes may occur, and v1.1.0 will be the first stable release.

## Features

- **Entity-Based Caching**: Global entity map with automatic deduplication across queries
- **Signalium Reactivity**: Automatic reactive updates when entities change
- **REST Query API**: Type-safe REST queries with path and search parameter interpolation
- **Infinite Queries**: Built-in support for paginated data fetching
- **Stream Queries**: Real-time updates via subscriptions
- **Smart Refetching**: Configurable stale-time, refetch intervals, and network-aware fetching
- **Request Deduplication**: Automatic deduplication of in-flight requests
- **Offline Support**: Response caching with configurable garbage collection
- **TypeScript First**: Full type inference for queries and responses
- **Framework Agnostic**: Works with React, or use standalone

## Installation

```bash
npm install @signalium/query signalium
```

For React support:

```bash
npm install @signalium/query signalium react
```

## Quick Start

### Basic Query

```typescript
import { QueryClient, SyncQueryStore, MemoryPersistentStore, query, t } from '@signalium/query';

// Create a query client
const store = new SyncQueryStore(new MemoryPersistentStore());
const client = new QueryClient(store, {
  fetch: globalThis.fetch,
});

// Define a query
const getUser = query(() => ({
  path: '/users/[id]',
  response: {
    id: t.number,
    name: t.string,
    email: t.string,
  },
}));

// Use the query with standard async/await syntax
const user = await getUser({ id: '123' });
console.log(user.name); // Fully typed!
```

### Entity Queries

Define entities to enable automatic caching and deduplication:

```typescript
import { entity, t } from '@signalium/query';

// Define an entity
const User = entity('User', () => ({
  id: t.number,
  name: t.string,
  email: t.string,
}));

// Use in a query
const getUser = query(() => ({
  path: '/users/[id]',
  response: User,
}));

// Multiple queries returning the same entity will share cached data
const user1 = await getUser({ id: '123' });
const user2 = await getUserFromTeam({ teamId: '456' }); // May return same User entity

// Both references will update reactively when the entity changes!
```

### Search Parameters

```typescript
const listUsers = query(() => ({
  path: '/users',
  searchParams: {
    page: t.number,
    limit: t.number,
    status: t.string.optional,
  },
  response: {
    users: t.array(User),
    total: t.number,
  },
}));

// Use with search params
const result = await listUsers({
  page: 1,
  limit: 10,
  status: 'active',
});
```

### Infinite Queries

```typescript
import { infiniteQuery } from '@signalium/query';

const listPosts = infiniteQuery(() => ({
  path: '/posts',
  searchParams: {
    cursor: t.string.optional,
    limit: t.number,
  },
  response: {
    posts: t.array(Post),
    nextCursor: t.string.optional,
  },
  getNextPageParams: lastPage => ({ cursor: lastPage.nextCursor }),
}));

const postsResult = listPosts({ limit: 20 });
const pages = await postsResult;

// Load more pages
if (postsResult.hasNextPage) {
  await postsResult.fetchNextPage();
}
```

### Stream Queries

For real-time updates:

```typescript
import { streamQuery } from '@signalium/query';

const subscribeToUser = streamQuery(() => ({
  path: '/users/[id]',
  response: User, // Must be an entity
  subscribeFn: (context, params, onUpdate) => {
    const ws = new WebSocket(`wss://api.example.com/users/${params.id}`);

    ws.onmessage = event => {
      const update = JSON.parse(event.data);
      onUpdate(update);
    };

    // Return unsubscribe function
    return () => ws.close();
  },
}));

// Subscribe to updates
const userStream = subscribeToUser({ id: '123' });
const user = await userStream;
// User will reactively update when new data arrives
```

## Caching Options

Configure caching behavior per query:

```typescript
const getUser = query(() => ({
  path: '/users/[id]',
  response: User,
  cache: {
    staleTime: 5000, // Data is fresh for 5 seconds
    gcTime: 300000, // Cache persists for 5 minutes after last use
    refetchInterval: 10000, // Refetch every 10 seconds when in use
    networkMode: 'online', // Only fetch when online
    retry: 3, // Retry failed requests 3 times
    refreshStaleOnReconnect: true, // Refetch stale data on reconnect
  },
}));
```

## React Integration

```typescript
import { QueryClientContext } from '@signalium/query';
import { reactive } from 'signalium/react';

// Provide the client
function App() {
  return (
    <QueryClientContext.Provider value={client}>
      <UserProfile userId="123" />
    </QueryClientContext.Provider>
  );
}

// Use queries in components
const UserProfile = reactive(({ userId }) => {
  const user = getUser({ id: userId });

  // While the user is loading initially, show a loading state
  if (!user.isReady) {
    return <div>Loading...</div>;
  }

  // Once the user is loaded and the result is ready, `user.value` is guaranteed
  // to be defined and have a loaded user value.
  return (
    <div>
      <h1>{user.value.name}</h1>
      <p>{user.value.email}</p>
    </div>
  );
});
```

## Store Types

### Synchronous Store

For in-memory only or synchronous persistence:

```typescript
import { SyncQueryStore, MemoryPersistentStore } from '@signalium/query';

const store = new SyncQueryStore(new MemoryPersistentStore());
```

### Asynchronous Store

For async persistence (IndexedDB, AsyncStorage, etc.):

```typescript
import { AsyncQueryStore } from '@signalium/query/stores/async';

const store = new AsyncQueryStore({
  async get(key) {
    /* ... */
  },
  async set(key, value) {
    /* ... */
  },
  async delete(key) {
    /* ... */
  },
  async clear() {
    /* ... */
  },
});
```

## Type Definitions

The `t` object provides type-safe validators:

- **Primitives**: `t.string`, `t.number`, `t.boolean`, `t.null`, `t.undefined`
- **Collections**: `t.array(type)`, `t.record(type)`, `t.object({ ... })`
- **Unions**: `t.union(t.string, t.number, t.null)`
- **Entities**: `entity(() => ({ ... }))`

## Network Management

Control network status and behavior:

```typescript
import { NetworkManager } from '@signalium/query';

const networkManager = new NetworkManager();

// Manually control network status
networkManager.setOnline(false);

// Listen to browser events (default)
networkManager.listen();

// Use in QueryClient
const client = new QueryClient(store, {
  fetch,
  networkManager,
});
```

## API Reference

### Core Exports

- `QueryClient` - Main query client class
- `QueryClientContext` - React context for client
- `query()` - Define a standard query
- `infiniteQuery()` - Define a paginated query
- `streamQuery()` - Define a streaming query
- `t` - Type definition helpers
- `entity()` - Define an entity type
- `SyncQueryStore` / `AsyncQueryStore` - Store implementations
- `NetworkManager` - Network status manager

### Type Utilities

- `QueryResult<T>` - Result type for queries
- `QueryContext` - Context passed to fetch functions
- `QueryCacheOptions` - Cache configuration options

## License

ISC

## Contributing

See the main [Signalium repository](https://github.com/Signalium/signalium) for contributing guidelines.
