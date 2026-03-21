---
title: fetchium/react
description: API reference for the fetchium React integration.
---

# fetchium/react

React hooks for using Fetchium queries in React components. Built on top of Signalium's `useReactive` hook.

```ts
import { useQuery } from 'fetchium/react';
```

---

## Hooks

### `useQuery`

```ts
function useQuery<T extends Query>(
  QueryClass: new () => T,
  params?: ExtractQueryParams<T>,
): QueryPromise<T>;
```

React hook for fetching a query. Subscribes the component to the query's reactive state, re-rendering when the query result changes. Internally uses Signalium's `useReactive` to bridge the reactive signal system with React's rendering cycle.

#### Parameters

| Parameter    | Type                    | Description                                                                                                                                                     |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QueryClass` | `new () => T`           | The query class to instantiate and execute. Must extend `Query` or `RESTQuery`.                                                                                 |
| `params`     | `ExtractQueryParams<T>` | Parameters matching the query's `params` shape. Optional if the query has no required params. Values can be Signalium `Signal`s for reactive parameter changes. |

#### Returns

`QueryPromise<T>` — a `DiscriminatedReactivePromise` that provides the query state.

The returned promise object has the following properties:

| Property     | Type             | Description                                                                                                                                          |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`      | `QueryResult<T>` | The resolved query result. Reading this while pending triggers React Suspense. Returns a deep clone to avoid accidental mutation of cached entities. |
| `isPending`  | `boolean`        | `true` while the query is loading (no cached data).                                                                                                  |
| `isResolved` | `boolean`        | `true` when the query has successfully resolved.                                                                                                     |
| `isRejected` | `boolean`        | `true` when the query has failed.                                                                                                                    |
| `error`      | `unknown`        | The error if `isRejected` is `true`.                                                                                                                 |

The resolved `QueryResult<T>` includes pagination helpers:

| Property          | Type                            | Description                                         |
| ----------------- | ------------------------------- | --------------------------------------------------- |
| `__refetch()`     | `() => QueryPromise<T>`         | Triggers a refetch and returns a new promise.       |
| `__loadNext()`    | `() => Promise<QueryResult<T>>` | Loads the next page (if configured via `loadNext`). |
| `__hasNext`       | `boolean`                       | Whether there is a next page available.             |
| `__isLoadingNext` | `boolean`                       | Whether a next-page request is currently in flight. |

#### Requirements

- A `QueryClient` must be provided via `QueryClientContext` using Signalium's `ContextProvider`.
- The component must be wrapped in a Signalium `component()` or use `useReactive` for the reactive system to function.

#### Example

```tsx
import { component } from 'signalium/react';
import { useQuery } from 'fetchium/react';

class GetUsers extends RESTQuery {
  result = {
    users: t.array(t.entity(User)),
    total: t.number,
  };

  path = '/api/users';
}

const UserList = component(() => {
  const query = useQuery(GetUsers);

  if (query.isPending) {
    return <div>Loading...</div>;
  }

  if (query.isRejected) {
    return <div>Error: {String(query.error)}</div>;
  }

  const { users, total } = query.value;

  return (
    <div>
      <h2>Users ({total})</h2>
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
});
```

#### With parameters

```tsx
const UserProfile = component(({ userId }: { userId: string }) => {
  const query = useQuery(GetUser, { id: userId });

  return <div>{query.value.name}</div>;
});
```

#### With reactive parameters

```tsx
import { signal } from 'signalium';

const searchTerm = signal('');

const SearchResults = component(() => {
  const query = useQuery(SearchUsers, { q: searchTerm });

  // Component re-renders when searchTerm changes and the query refetches
  return <div>{query.value.results.length} results</div>;
});
```

#### Notes

- `useQuery` calls `useReactive` twice internally: once for the query itself and once to subscribe to the resolved value for deep entity tracking via Signalium's `CONSUME_DEEP` protocol.
- The `value` property returns a **deep clone** of the query result to prevent accidental mutation of the entity cache. Use `draft()` from `fetchium` if you need a mutable copy for mutations.
- When used with React Suspense, reading `.value` on a pending query will suspend the component.
