---
title: Queries
---

Queries are the primary way to fetch data in Fetchium. Each query is a class that describes a single API request --- its path, parameters, HTTP method, and the shape of the response. The library takes care of caching, deduplication, refetching, and entity normalization behind the scenes.

---

## What is a Query?

A Query is a class that extends `RESTQuery` (or the lower-level `Query` base class). It declares:

- **`params`** --- the parameters the query accepts (path params, search params, body fields)
- **`path`** --- the URL path, with bracket-based interpolation for params
- **`result`** --- the shape of the response data, using the `t` type DSL or an Entity class

When you call `fetchQuery(GetUser, { id: 42 })` or `useQuery(GetUser, { id: 42 })`, Fetchium instantiates the query definition, interpolates the path, executes the fetch, parses the response against the result shape, normalizes any entities, and returns a reactive `QueryPromise`.

---

## Defining a Query

The simplest query extends `RESTQuery` and sets three fields:

```tsx
import { RESTQuery, t, Entity } from 'fetchium';

class User extends Entity {
  id = t.id;
  name = t.string;
  email = t.string;
  avatarUrl = t.nullable(t.string);
}

class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]';
  result = User;
}
```

- `params` defines what the caller must provide. Each key maps to a type from the `t` DSL.
- `path` is the URL path. Segments wrapped in `[brackets]` are replaced with the matching param value.
- `result` defines the response shape. It can be an Entity class, a `t.object(...)`, a `t.array(...)`, or any other type definition.

{% callout title="Query classes are definitions, not instances" type="note" %}
You never call `new GetUser()` yourself. Fetchium instantiates the class internally to extract its definition, then caches and reuses it. Think of query classes as declarative descriptions of an API endpoint.
{% /callout %}

### Non-entity results

If your endpoint returns a plain object rather than an entity, use `t.object(...)` for the result:

```tsx
class GetServerHealth extends RESTQuery {
  path = '/health';
  result = t.object({
    status: t.string,
    uptime: t.number,
    version: t.string,
  });
}
```

### Array results

For endpoints that return a list, use `t.array(...)`:

```tsx
class ListUsers extends RESTQuery {
  path = '/users';
  result = t.array(User);
}
```

Because `User` is an Entity, each item in the returned array is normalized into the entity cache. If another query fetches the same user by ID, they share the same cache entry.

---

## The `t` Type DSL

The `t` object provides a concise way to define the types of params, result fields, and entity fields. It serves two purposes: it gives Fetchium the information it needs to parse and validate responses, and it provides full TypeScript type inference so your query results are strongly typed.

### Primitives

| Definition    | TypeScript type | Description       |
| ------------- | --------------- | ----------------- |
| `t.string`    | `string`        | String value      |
| `t.number`    | `number`        | Number value      |
| `t.boolean`   | `boolean`       | Boolean value     |
| `t.null`      | `null`          | Literal null      |
| `t.undefined` | `undefined`     | Literal undefined |

### Identity

| Definition | TypeScript type    | Description                                                                |
| ---------- | ------------------ | -------------------------------------------------------------------------- |
| `t.id`     | `string \| number` | Marks the identity field for entity normalization. Every Entity needs one. |

### Entity references

| Definition        | TypeScript type | Description                                                                    |
| ----------------- | --------------- | ------------------------------------------------------------------------------ |
| `t.entity(Class)` | `Class`         | A reference to another Entity class. Enables normalization of nested entities. |

```tsx
class Comment extends Entity {
  id = t.id;
  body = t.string;
  author = t.entity(User); // normalized reference to User
}
```

### Collections and objects

| Definition          | TypeScript type        | Description                               |
| ------------------- | ---------------------- | ----------------------------------------- |
| `t.array(type)`     | `type[]`               | Array of the given type                   |
| `t.object({ ... })` | `{ ... }`              | Plain object with known fields            |
| `t.record(type)`    | `Record<string, type>` | String-keyed dictionary of the given type |

```tsx
// Array of entities
result = t.array(User);

// Plain object
result = t.object({
  total: t.number,
  users: t.array(User),
});

// Record / dictionary
result = t.object({
  usersById: t.record(User),
});
```

### Optionality and nullability

| Definition         | TypeScript type             | Description                    |
| ------------------ | --------------------------- | ------------------------------ |
| `t.optional(type)` | `type \| undefined`         | Value may be undefined         |
| `t.nullable(type)` | `type \| null`              | Value may be null              |
| `t.nullish(type)`  | `type \| null \| undefined` | Value may be null or undefined |

```tsx
class User extends Entity {
  id = t.id;
  name = t.string;
  bio = t.optional(t.string); // string | undefined
  avatarUrl = t.nullable(t.string); // string | null
  nickname = t.nullish(t.string); // string | null | undefined
}
```

### Constants and enums

| Definition          | TypeScript type   | Description             |
| ------------------- | ----------------- | ----------------------- |
| `t.const(value)`    | Literal type      | Exact literal value     |
| `t.enum(...values)` | Union of literals | One of the given values |

```tsx
class Post extends Entity {
  id = t.id;
  type = t.typename('Post'); // discriminator for unions
  status = t.enum('draft', 'published', 'archived');
  priority = t.const(1); // always the number 1
}
```

`t.enum` also supports case-insensitive matching via `t.enum.caseInsensitive(...)` --- useful when your API returns inconsistent casing.

### Formatted values

| Definition       | TypeScript type        | Description                                           |
| ---------------- | ---------------------- | ----------------------------------------------------- |
| `t.format(name)` | Registered format type | Parses raw values into rich types (e.g. Date objects) |

Fetchium ships with built-in `'date'` and `'date-time'` formats:

```tsx
class Event extends Entity {
  id = t.id;
  name = t.string;
  startDate = t.format('date'); // "2024-03-15" -> Date object
  createdAt = t.format('date-time'); // ISO 8601 string -> Date object
}
```

You can register custom formats with `registerFormat()` from `fetchium`.

### Unions

| Definition          | TypeScript type    | Description                             |
| ------------------- | ------------------ | --------------------------------------- |
| `t.union(...types)` | Union of the types | Discriminated union of objects/entities |

Unions use a typename discriminator field to determine which variant to parse:

```tsx
class TextBlock extends Entity {
  id = t.id;
  type = t.typename('TextBlock');
  content = t.string;
}

class ImageBlock extends Entity {
  id = t.id;
  type = t.typename('ImageBlock');
  url = t.string;
  alt = t.optional(t.string);
}

class GetBlocks extends RESTQuery {
  path = '/blocks';
  result = t.array(t.union(TextBlock, ImageBlock));
}
```

{% callout title="Type DSL Deep Dive" type="note" %}
This section covers the most common type definitions. For advanced usage including `t.result()`, custom formats, and the union type system in detail, see the [Type DSL Deep Dive](/reference/type-dsl).
{% /callout %}

---

## Path Interpolation

Path segments wrapped in square brackets are replaced with the matching param value:

```tsx
class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]'; // /users/42
  result = User;
}

class GetUserPost extends RESTQuery {
  params = { userId: t.number, postId: t.number };
  path = '/users/[userId]/posts/[postId]'; // /users/42/posts/7
  result = Post;
}
```

Only params that appear in the path are interpolated. Additional params can be used as search parameters or body fields.

---

## Search Parameters

Use the `searchParams` field to append query string parameters to the URL:

```tsx
class SearchUsers extends RESTQuery {
  params = {
    query: t.string,
    page: t.optional(t.number),
    limit: t.optional(t.number),
  };
  path = '/users/search';
  searchParams = {
    q: this.params.query,
    page: this.params.page,
    limit: this.params.limit,
  };
  result = t.object({
    users: t.array(User),
    total: t.number,
  });
}
```

`searchParams` values that are `undefined` or `null` are omitted from the query string. The example above would produce a URL like `/users/search?q=alice&page=1&limit=20`.

---

## HTTP Configuration

`RESTQuery` defaults to `GET` requests. You can configure the HTTP method, headers, body, and request options:

```tsx
class CreateUser extends RESTQuery {
  params = {
    name: t.string,
    email: t.string,
  };
  method = 'POST' as const;
  path = '/users';
  body = {
    name: this.params.name,
    email: this.params.email,
  };
  headers = { 'X-Custom-Header': 'value' };
  result = User;
}
```

### Available fields

| Field            | Type                      | Default | Description                                                  |
| ---------------- | ------------------------- | ------- | ------------------------------------------------------------ |
| `method`         | `string`                  | `'GET'` | HTTP method                                                  |
| `path`           | `string`                  | ---     | URL path with bracket interpolation                          |
| `searchParams`   | `Record<string, unknown>` | ---     | Query string parameters                                      |
| `body`           | `Record<string, unknown>` | ---     | JSON request body (auto-sets Content-Type header)            |
| `headers`        | `HeadersInit`             | ---     | Additional request headers                                   |
| `requestOptions` | `QueryRequestOptions`     | ---     | Fetch options like `credentials`, `mode`, `cache`, `baseUrl` |

---

## Dynamic Configuration

For queries that need runtime logic to determine their configuration, override the corresponding `get*` methods. These take priority over the static field values:

```tsx
class GetUserPosts extends RESTQuery {
  params = {
    userId: t.number,
    status: t.optional(t.string),
  };
  path = '/users/[userId]/posts';
  result = t.array(Post);

  getSearchParams() {
    const status = this.params.status;
    // Only include status param if it's provided
    return status ? { status } : undefined;
  }
}
```

### Override methods

| Method                | Returns                       | Description                        |
| --------------------- | ----------------------------- | ---------------------------------- |
| `getPath()`           | `string \| undefined`         | Dynamic path override              |
| `getMethod()`         | `string`                      | Dynamic HTTP method                |
| `getSearchParams()`   | `Record \| undefined`         | Dynamic search params              |
| `getBody()`           | `Record \| undefined`         | Dynamic request body               |
| `getRequestOptions()` | `RequestOptions \| undefined` | Dynamic fetch options              |
| `getConfig()`         | `ConfigOptions \| undefined`  | Dynamic cache/retry/network config |

When both a static field and a `get*` method are defined, the method takes priority.

---

## Fetching a Query

Use the toggle in the header to switch between React hooks and Signalium examples.

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function UserList() {
  const result = useQuery(ListUsers);

  if (!result.isReady) return <div>Loading...</div>;
  if (result.isRejected) return <div>Error: {result.error.message}</div>;

  return (
    <ul>
      {result.value.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const UserList = component(() => {
  const result = fetchQuery(ListUsers);

  if (!result.isReady) return <div>Loading...</div>;
  if (result.isRejected) return <div>Error: {result.error.message}</div>;

  return (
    <ul>
      {result.value.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
});
```

### The QueryPromise

Both `useQuery` and `fetchQuery` return a `QueryPromise` --- a reactive object that tracks the lifecycle of the fetch:

| Property     | Type      | Description                                                             |
| ------------ | --------- | ----------------------------------------------------------------------- |
| `value`      | `T`       | The resolved data. Only valid when `isResolved` is true.                |
| `error`      | `Error`   | The rejection error. Only valid when `isRejected` is true.              |
| `isPending`  | `boolean` | True while the initial fetch is in flight                               |
| `isReady`    | `boolean` | True once data is available (even if a background refetch is happening) |
| `isResolved` | `boolean` | True when the fetch completed successfully                              |
| `isRejected` | `boolean` | True when the fetch failed                                              |

The promise also exposes a `__refetch()` method to manually trigger a re-fetch.

{% callout title="Reactive properties" type="note" %}
Every property on the `QueryPromise` is reactive. Reading `result.value` inside a Signalium reactive function automatically subscribes to changes. In React, `useQuery` handles the subscription for you.
{% /callout %}

---

## Caching & Staleness

Fetchium caches query results automatically. You control cache behavior with a static `cache` property on the query class and a `config` field (or `getConfig()` method) on the instance.

### Static cache options

Set the static `cache` property on your query class to configure persistent storage behavior:

```tsx
class GetUser extends RESTQuery {
  static cache = {
    maxCount: 100, // max entries to keep in persistent storage
    cacheTime: 1440, // minutes until persistent cache expires (default: 1440 = 24h)
  };

  params = { id: t.number };
  path = '/users/[id]';
  result = User;
}
```

### Instance config options

The `config` field (or `getConfig()` override) controls in-memory caching and fetch behavior:

```tsx
class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]';
  result = User;

  config = {
    staleTime: 30_000, // data is fresh for 30 seconds
    gcTime: 10, // evict from memory after 10 minutes of no subscribers
    retry: 3, // retry up to 3 times on failure
  };
}
```

### Config reference

| Option                    | Type                               | Default                 | Description                                                                                                          |
| ------------------------- | ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `staleTime`               | `number`                           | `0`                     | Milliseconds that data is considered fresh. `0` means always stale.                                                  |
| `gcTime`                  | `number`                           | `5`                     | Minutes before an unwatched query is evicted from memory. Use `Infinity` to never evict, `0` for next-tick eviction. |
| `networkMode`             | `NetworkMode`                      | `'online'`              | When to fetch: `'always'`, `'online'`, or `'offlineFirst'`                                                           |
| `retry`                   | `number \| boolean \| RetryConfig` | `3` client / `0` server | Number of retries, or a config object with `retries` and `retryDelay`                                                |
| `debounce`                | `number`                           | `0`                     | Milliseconds to debounce refetches when params change                                                                |
| `refreshStaleOnReconnect` | `boolean`                          | `true`                  | Whether to refetch stale queries when the network reconnects                                                         |

### Network modes

- **`'online'`** (default) --- Only fetch when the browser is online. Queries pause when offline and resume when connectivity returns.
- **`'always'`** --- Fetch regardless of network status. Useful for local APIs or service workers.
- **`'offlineFirst'`** --- Serve cached data immediately, then refetch in the background when online.

### Retry configuration

By default, queries retry 3 times on the client and 0 times on the server. You can customize this:

```tsx
class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]';
  result = User;

  config = {
    // Simple: retry up to 5 times
    retry: 5,

    // Or detailed config:
    retry: {
      retries: 3,
      retryDelay: (attempt) => 1000 * Math.pow(2, attempt), // exponential backoff
    },
  };
}
```

Set `retry: false` or `retry: 0` to disable retries entirely.

### Dynamic config with getConfig()

For runtime-dependent configuration, override `getConfig()`:

```tsx
class GetDashboard extends RESTQuery {
  path = '/dashboard';
  result = Dashboard;

  getConfig() {
    return {
      staleTime: 60_000, // fresh for 1 minute
      gcTime: 30, // keep in memory for 30 minutes
      networkMode: 'offlineFirst', // serve cache first
    };
  }
}
```

---

## Polling and Background Refetching

When `staleTime` is set, Fetchium automatically refetches stale queries that have active subscribers. This means your UI stays up to date without any manual polling setup:

```tsx
class GetNotifications extends RESTQuery {
  path = '/notifications';
  result = t.array(Notification);

  config = {
    staleTime: 10_000, // refetch every 10 seconds while subscribed
  };
}
```

As long as a component is subscribed to `GetNotifications`, Fetchium will refetch the data every 10 seconds. When the component unmounts and no other subscribers remain, refetching stops and the `gcTime` countdown begins.

If you need to force a refetch regardless of staleness, use the `__refetch()` method on the query result:

```tsx
const notifications = useQuery(GetNotifications);

// Force refetch on button click
<button onClick={() => notifications.__refetch()}>Refresh</button>;
```

---

## Storage Keys

Each query instance is identified by a storage key, which determines its cache identity. By default, `RESTQuery` computes the key as:

```
${method}:${interpolatedPath}
```

For example, `GetUser` with `{ id: 42 }` produces the key `GET:/users/42`.

You can override `getStorageKey()` for custom cache keying:

```tsx
class SearchUsers extends RESTQuery {
  params = {
    query: t.string,
    filters: t.optional(t.object({ role: t.string })),
  };
  path = '/users/search';
  result = t.array(User);

  getStorageKey() {
    return `search:${this.params.query}:${this.params.filters?.role ?? 'all'}`;
  }
}
```

Two query instances with the same storage key share the same cache entry and are deduplicated --- only one network request is made at a time.

---

## Next Steps

{% quick-links %}

{% quick-link title="Entities" icon="plugins" href="/core/entities" description="Learn about normalized entity caching and identity-stable proxies" /%}

{% quick-link title="Mutations" icon="theming" href="/core/mutations" description="Create, update, and delete data with optimistic updates" /%}

{% quick-link title="Type DSL Deep Dive" icon="presets" href="/reference/type-dsl" description="Advanced type definitions, unions, formats, and more" /%}

{% quick-link title="Pagination" icon="installation" href="/reference/pagination" description="Infinite scroll and cursor-based pagination patterns" /%}

{% /quick-links %}
