---
title: fetchium
description: API reference for the main fetchium package.
---

# fetchium

API reference for the main `fetchium` package — a data-fetching and query layer built on Signalium's reactive primitives.

```ts
import {
  Query,
  RESTQuery,
  fetchQuery,
  queryKeyForClass,
  Mutation,
  RESTMutation,
  getMutation,
  mutationKeyForClass,
  Entity,
  QueryClient,
  NetworkManager,
  NoOpNetworkManager,
  GcManager,
  NoOpGcManager,
  t,
  registerFormat,
  draft,
  QueryClientContext,
  NetworkManagerContext,
} from 'fetchium';
```

---

## Classes

### `Query` (abstract)

Base class for all query definitions. Extend this to define custom data-fetching logic.

#### Static properties

| Property | Type                             | Description                                                  |
| -------- | -------------------------------- | ------------------------------------------------------------ |
| `cache`  | `QueryCacheOptions \| undefined` | Class-level persistent cache settings (maxCount, cacheTime). |

#### Instance properties

| Property   | Type                                   | Description                                                                 |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `params`   | `Record<string, TypeDef> \| undefined` | Shape definition for query parameters.                                      |
| `result`   | `TypeDefShape`                         | **(abstract)** Shape definition for the query result.                       |
| `config`   | `QueryConfigOptions \| undefined`      | Instance-level configuration (gcTime, staleTime, retry, etc.).              |
| `context`  | `QueryContext`                         | The query context provided by the `QueryClient`. Available during `send()`. |
| `response` | `Response \| undefined`                | The raw fetch `Response` object, set after `send()` completes.              |
| `signal`   | `AbortSignal`                          | Abort signal for cancelling the in-flight request.                          |

#### Methods

| Method          | Signature                                | Description                                                                                |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getStorageKey` | `(): unknown`                            | **(abstract)** Returns a value used to compute the cache/storage key for this query class. |
| `send`          | `(): Promise<unknown>`                   | **(abstract)** Executes the network request and returns the raw response data.             |
| `refetch`       | `(): void`                               | Triggers a refetch of this query, bypassing staleTime.                                     |
| `getConfig`     | `(): QueryConfigOptions \| undefined`    | Optional override. Dynamically compute config at execution time.                           |
| `sendNext`      | `(args: SendNextArgs): Promise<unknown>` | Optional. Fetches the next page of paginated data.                                         |
| `hasNext`       | `(args: SendNextArgs): boolean`          | Optional. Returns `true` if there is a next page to load.                                  |

---

### `RESTQuery` extends `Query`

Convenience base class for REST/JSON queries. Handles URL construction, search params, body serialization, and pagination.

#### Instance properties

| Property         | Type                                              | Default | Description                                                                        |
| ---------------- | ------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `method`         | `'GET' \| 'POST' \| 'PUT' \| 'DELETE' \| 'PATCH'` | `'GET'` | HTTP method.                                                                       |
| `path`           | `string \| undefined`                             | —       | URL path. Supports `[param]` interpolation via the type DSL.                       |
| `searchParams`   | `Record<string, unknown> \| undefined`            | —       | Query string parameters.                                                           |
| `body`           | `Record<string, unknown> \| undefined`            | —       | Request body (JSON-serialized).                                                    |
| `headers`        | `HeadersInit \| undefined`                        | —       | Custom HTTP headers.                                                               |
| `requestOptions` | `QueryRequestOptions \| undefined`                | —       | Additional fetch options (credentials, mode, baseUrl, etc.).                       |
| `loadNext`       | `LoadNextConfig \| undefined`                     | —       | Static pagination config. Values can be FieldRefs (e.g. `this.result.nextCursor`). |

#### `getStorageKey()` default

Returns `"${method}:${path}"`.

#### Optional method overrides

| Method              | Signature                                  | Description                                                                             |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `getPath`           | `(): string \| undefined`                  | Dynamically compute the URL path.                                                       |
| `getMethod`         | `(): string`                               | Dynamically compute the HTTP method.                                                    |
| `getSearchParams`   | `(): Record<string, unknown> \| undefined` | Dynamically compute search params.                                                      |
| `getBody`           | `(): Record<string, unknown> \| undefined` | Dynamically compute the request body.                                                   |
| `getRequestOptions` | `(): QueryRequestOptions \| undefined`     | Dynamically compute fetch options.                                                      |
| `getLoadNext`       | `(): LoadNextConfig \| undefined`          | Dynamically compute pagination config. Takes priority over the static `loadNext` field. |

#### Example

```ts
class GetUser extends RESTQuery {
  params = { id: t.string };
  result = {
    id: t.id,
    name: t.string,
    email: t.string,
  };

  path = '/api/users/[id]';
}
```

---

### `Entity`

Base class for entity definitions. Entities are normalized, identity-stable proxy objects managed by the `QueryClient`.

#### Static properties

| Property | Type                               | Description                                                                    |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| `cache`  | `{ gcTime?: number } \| undefined` | In-memory GC time in minutes. `0` = next-tick eviction, `Infinity` = never GC. |

#### Optional instance methods

| Method        | Signature                                                                | Description                                                                                             |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `__subscribe` | `(onEvent: (event: MutationEvent) => void) => (() => void) \| undefined` | Subscribe to external mutation events for this entity (e.g. WebSocket push). Return a cleanup function. |

#### Example

```ts
class User extends Entity {
  static cache = { gcTime: 10 };

  id = t.id;
  __typename = 'User';
  name = t.string;
  email = t.optional(t.string);
}
```

---

### `Mutation` (abstract)

Base class for mutation definitions.

#### Instance properties

| Property            | Type                                 | Description                                                             |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `params`            | `TypeDefShape \| undefined`          | Shape definition for mutation input parameters.                         |
| `result`            | `TypeDefShape \| undefined`          | Shape definition for the mutation response.                             |
| `optimisticUpdates` | `boolean \| undefined`               | When `true`, applies effects optimistically before the server responds. |
| `config`            | `MutationConfigOptions \| undefined` | Mutation configuration (retry settings).                                |
| `effects`           | `MutationEffects \| undefined`       | Static entity effects (creates, updates, deletes).                      |
| `context`           | `QueryContext`                       | The query context. Available during `send()`.                           |
| `response`          | `Response \| undefined`              | Raw fetch response after `send()` completes.                            |
| `signal`            | `AbortSignal`                        | Abort signal for the request.                                           |

#### Methods

| Method          | Signature              | Description                                                               |
| --------------- | ---------------------- | ------------------------------------------------------------------------- |
| `send`          | `(): Promise<unknown>` | **(abstract)** Executes the mutation request.                             |
| `getStorageKey` | `(): unknown`          | **(abstract)** Returns a value used to compute the mutation identity key. |
| `getEffects`    | `(): MutationEffects`  | Optional. Dynamically compute entity effects at execution time.           |

---

### `RESTMutation` extends `Mutation`

Convenience base class for REST/JSON mutations.

#### Instance properties

| Property         | Type                                     | Default  | Description                                            |
| ---------------- | ---------------------------------------- | -------- | ------------------------------------------------------ |
| `path`           | `string \| undefined`                    | —        | URL path.                                              |
| `method`         | `'POST' \| 'PUT' \| 'DELETE' \| 'PATCH'` | `'POST'` | HTTP method.                                           |
| `body`           | `Record<string, unknown> \| undefined`   | —        | Request body shape. Falls back to `params` if not set. |
| `headers`        | `HeadersInit \| undefined`               | —        | Custom HTTP headers.                                   |
| `requestOptions` | `QueryRequestOptions \| undefined`       | —        | Additional fetch options.                              |

#### `getStorageKey()` default

Returns `"${method}:${path}"`.

#### Optional method overrides

| Method              | Signature                                  | Description                           |
| ------------------- | ------------------------------------------ | ------------------------------------- |
| `getPath`           | `(): string \| undefined`                  | Dynamically compute the URL path.     |
| `getMethod`         | `(): string`                               | Dynamically compute the HTTP method.  |
| `getBody`           | `(): Record<string, unknown> \| undefined` | Dynamically compute the request body. |
| `getRequestOptions` | `(): QueryRequestOptions \| undefined`     | Dynamically compute fetch options.    |

---

### `QueryClient`

Central coordinator for queries, mutations, entity storage, caching, and garbage collection.

#### Constructor

```ts
new QueryClient(
  store: QueryStore,
  context?: QueryContext,
  networkManager?: NetworkManager,
  gcManager?: GcManager | NoOpGcManager,
)
```

| Parameter        | Type                         | Default                   | Description                                          |
| ---------------- | ---------------------------- | ------------------------- | ---------------------------------------------------- |
| `store`          | `QueryStore`                 | —                         | Persistent storage backend.                          |
| `context`        | `QueryContext`               | `{ fetch, log: console }` | Provides the `fetch` function, base URL, and logger. |
| `networkManager` | `NetworkManager`             | `new NetworkManager()`    | Tracks network connectivity.                         |
| `gcManager`      | `GcManager \| NoOpGcManager` | Auto-detected             | GC manager. Uses `NoOpGcManager` on the server.      |

#### Methods

| Method               | Signature                      | Description                                                                    |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `getContext`         | `(): QueryContext`             | Returns the `QueryContext` passed at construction.                             |
| `applyMutationEvent` | `(event: MutationEvent): void` | Applies an external mutation event (create/update/delete) to the entity store. |
| `destroy`            | `(): void`                     | Tears down the GC manager, network manager, and all caches.                    |

---

### `NetworkManager`

Signal-based network connectivity tracker. Automatically detects browser online/offline events.

#### Constructor

```ts
new NetworkManager(initialStatus?: boolean)
```

| Parameter       | Type      | Default       | Description                                                 |
| --------------- | --------- | ------------- | ----------------------------------------------------------- |
| `initialStatus` | `boolean` | Auto-detected | Initial online status. If omitted, uses `navigator.onLine`. |

#### Properties and methods

| Member                | Type / Signature          | Description                                                                          |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `isOnline`            | `boolean` (getter)        | Returns `true` if the network is currently online. Manual override takes precedence. |
| `setNetworkStatus`    | `(online: boolean): void` | Manually set the network status.                                                     |
| `clearManualOverride` | `(): void`                | Clear any manual override and return to automatic detection.                         |
| `getOnlineSignal`     | `(): Signal<boolean>`     | Returns the underlying reactive Signal for online status.                            |
| `destroy`             | `(): void`                | Removes event listeners and cleans up resources.                                     |

---

### `NoOpNetworkManager`

SSR-safe no-op implementation of `NetworkManager`. Always reports `isOnline = true`.

| Member                | Type / Signature          | Description                      |
| --------------------- | ------------------------- | -------------------------------- |
| `isOnline`            | `boolean` (getter)        | Always returns `true`.           |
| `setNetworkStatus`    | `(online: boolean): void` | No-op.                           |
| `clearManualOverride` | `(): void`                | No-op.                           |
| `getOnlineSignal`     | `(): Signal<boolean>`     | Returns a static `Signal(true)`. |
| `destroy`             | `(): void`                | No-op.                           |

---

### `GcManager`

Bucket-based in-memory garbage collection. Each unique `gcTime` gets its own interval with two rotating sets. Minimum eviction delay is approximately `gcTime`; maximum is approximately `2 * gcTime`.

#### Constructor

```ts
new GcManager(
  onEvict: (key: number, type: GcKeyType) => void,
  multiplier?: number,
)
```

| Parameter    | Type                                     | Default | Description                                                    |
| ------------ | ---------------------------------------- | ------- | -------------------------------------------------------------- |
| `onEvict`    | `(key: number, type: GcKeyType) => void` | —       | Callback invoked when a key is evicted.                        |
| `multiplier` | `number`                                 | `1`     | Multiplier applied to `gcTime` intervals (useful for testing). |

#### Methods

| Method     | Signature                                              | Description                                                                                           |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `schedule` | `(key: number, gcTime: number, type: GcKeyType): void` | Schedule a key for eviction. `gcTime = 0` evicts on next microtask. `gcTime = Infinity` never evicts. |
| `cancel`   | `(key: number, gcTime: number): void`                  | Cancel a pending eviction.                                                                            |
| `destroy`  | `(): void`                                             | Clears all intervals and pending entries.                                                             |

---

### `NoOpGcManager`

No-op garbage collection manager. All methods are no-ops.

| Method     | Signature                                              |
| ---------- | ------------------------------------------------------ |
| `schedule` | `(key: number, gcTime: number, type: GcKeyType): void` |
| `cancel`   | `(key: number, gcTime: number): void`                  |
| `destroy`  | `(): void`                                             |

---

## Functions

### `fetchQuery`

```ts
function fetchQuery<T extends Query>(
  QueryClass: new () => T,
  params?: ExtractQueryParams<T>,
): QueryPromise<T>;
```

Fetches a query reactively. Must be called within a reactive context where `QueryClientContext` is provided. Returns a `QueryPromise` (a `DiscriminatedReactivePromise`) that resolves to the query result.

| Parameter    | Type                    | Description                                                                                                                                                     |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QueryClass` | `new () => T`           | The query class to instantiate and execute.                                                                                                                     |
| `params`     | `ExtractQueryParams<T>` | Parameters matching the query's `params` shape. Optional if the query has no required params. Values can be Signalium `Signal`s for reactive parameter changes. |

**Returns:** `QueryPromise<T>` — a reactive promise with `.value`, `.isPending`, `.isResolved`, `.isRejected`, `.error`.

---

### `getMutation`

```ts
function getMutation<T extends Mutation>(
  MutationClass: new () => T,
): ReactiveTask<ExtractType<T['result']>, [ExtractType<T['params']>]>;
```

Returns a `ReactiveTask` for executing a mutation. Must be called within a reactive context where `QueryClientContext` is provided.

| Parameter       | Type          | Description                        |
| --------------- | ------------- | ---------------------------------- |
| `MutationClass` | `new () => T` | The mutation class to instantiate. |

**Returns:** `ReactiveTask` — call `.run(params)` to execute the mutation.

---

### `queryKeyForClass`

```ts
function queryKeyForClass(cls: new () => Query, params: unknown): number;
```

Computes the numeric cache key for a query class and params combination. Useful for cache invalidation or inspection.

---

### `mutationKeyForClass`

```ts
function mutationKeyForClass(cls: new () => Mutation): string;
```

Returns the string identity key for a mutation class. Derived from the mutation's `getStorageKey()`.

---

### `registerFormat`

```ts
function registerFormat<Input extends Mask.STRING | Mask.NUMBER, T>(
  name: string,
  type: Input,
  parse: (value: Input extends Mask.STRING ? string : number) => T,
  serialize: (value: T) => Input extends Mask.STRING ? string : number,
  options?: { eager?: boolean },
): void;
```

Registers a custom format for use with `t.format(name)`. Built-in formats include `'date'` and `'date-time'`.

| Parameter       | Type                         | Description                                                                                        |
| --------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `name`          | `string`                     | Format name. Use with `t.format(name)`.                                                            |
| `type`          | `Mask.STRING \| Mask.NUMBER` | The underlying wire type (string or number).                                                       |
| `parse`         | `(value) => T`               | Converts the raw wire value into the formatted type.                                               |
| `serialize`     | `(value) => wire`            | Converts the formatted type back to the wire value.                                                |
| `options.eager` | `boolean`                    | If `true` (default), parsing runs eagerly during entity construction. If `false`, parsing is lazy. |

To add TypeScript types for custom formats, use module augmentation:

```ts
declare global {
  namespace SignaliumQuery {
    interface FormatRegistry {
      'my-format': MyType;
    }
  }
}
```

---

### `draft`

```ts
function draft<T>(value: T): Draft<T>;
```

Deep clones an entity or object, returning a plain mutable copy. The draft is not an entity proxy and can be freely modified before being passed to a mutation.

| Parameter | Type | Description                    |
| --------- | ---- | ------------------------------ |
| `value`   | `T`  | The entity or object to clone. |

**Returns:** `Draft<T>` — a recursively mutable deep clone.

---

## The `t` Type DSL

The `t` object provides a declarative type definition DSL for describing query parameters, results, and entity shapes.

### Primitive types

| Property      | Type                        | Description                                                                                 |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| `t.string`    | `TypeDef<string>`           | String type.                                                                                |
| `t.number`    | `TypeDef<number>`           | Number type.                                                                                |
| `t.boolean`   | `TypeDef<boolean>`          | Boolean type.                                                                               |
| `t.null`      | `TypeDef<null>`             | Null literal type.                                                                          |
| `t.undefined` | `TypeDef<undefined>`        | Undefined literal type.                                                                     |
| `t.id`        | `TypeDef<string \| number>` | Identity field marker. Marks the field as the entity's unique ID. Accepts string or number. |

### Composite types

| Method     | Signature                                          | Description                                                                      |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `t.array`  | `(type: TypeDef<T>) => TypeDef<T[]>`               | Array of the given element type.                                                 |
| `t.object` | `(shape: Record<string, TypeDef>) => TypeDef<...>` | Object with the given field shapes.                                              |
| `t.record` | `(type: TypeDef<T>) => TypeDef<Record<string, T>>` | Record (dictionary) with string keys and values of the given type.               |
| `t.union`  | `(...types: TypeDef[]) => TypeDef<...>`            | Discriminated union. Object types must have a typename field for discrimination. |
| `t.entity` | `(cls: new () => Entity) => TypeDef<Entity>`       | Reference to a normalized entity type.                                           |

### Modifiers

| Method       | Signature                                               | Description                                                |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| `t.optional` | `(type: TypeDef<T>) => TypeDef<T \| undefined>`         | Makes a type optional (allows `undefined`).                |
| `t.nullable` | `(type: TypeDef<T>) => TypeDef<T \| null>`              | Makes a type nullable (allows `null`).                     |
| `t.nullish`  | `(type: TypeDef<T>) => TypeDef<T \| undefined \| null>` | Makes a type nullish (allows both `undefined` and `null`). |

### Constants and enums

| Method                   | Signature                                | Description                                                                                |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `t.const`                | `(value: T) => TypeDef<T>`               | Constant literal value.                                                                    |
| `t.enum`                 | `(...values: T[]) => TypeDef<T[number]>` | Enum of allowed values (strings, numbers, or booleans).                                    |
| `t.enum.caseInsensitive` | `(...values: T[]) => TypeDef<T[number]>` | Case-insensitive enum. String values match case-insensitively but return canonical casing. |

### Formats

| Method     | Signature                                         | Description                                                                                   |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `t.format` | `(name: string) => TypeDef<FormatRegistry[name]>` | A formatted value. Built-in: `'date'` (YYYY-MM-DD to Date), `'date-time'` (ISO 8601 to Date). |

### Result parsing

| Method     | Signature                                       | Description                                                                                                                                                                                 |
| ---------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t.result` | `(type: TypeDef<T>) => TypeDef<ParseResult<T>>` | Wraps a type in a `ParseResult<T>` (`{ success: true, value: T } \| { success: false, error: Error }`). Individual fields that fail validation produce an error result instead of throwing. |

### Live collections

| Method        | Signature                                                                                        | Description                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `t.liveArray` | `(entity: EntityClass \| EntityClass[], opts?: LiveArrayOptions) => TypeDef<E[]>`                | A live array that automatically updates when matching entities are created, updated, or deleted via mutation events.           |
| `t.liveValue` | `(type: TypeDef<V>, entity: EntityClass \| EntityClass[], opts: LiveValueOptions) => TypeDef<V>` | A live derived value that recomputes when matching entities change. Requires `onCreate`, `onUpdate`, and `onDelete` callbacks. |

#### `LiveArrayOptions<E>`

| Property      | Type                     | Description                                                                                                                                                      |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constraints` | `ConstraintDef<E>`       | Filter which entities are included. Can be a `Record<string, unknown>` or an array of `[EntityClass, constraintMap]` tuples. Constraint values can be FieldRefs. |
| `sort`        | `(a: E, b: E) => number` | Sort comparator for the array.                                                                                                                                   |

#### `LiveValueOptions<V, E>`

| Property      | Type                         | Description                                                      |
| ------------- | ---------------------------- | ---------------------------------------------------------------- |
| `constraints` | `ConstraintDef<E>`           | Filter which entities trigger recomputation.                     |
| `onCreate`    | `(value: V, entity: E) => V` | Called when a matching entity is created. Returns the new value. |
| `onUpdate`    | `(value: V, entity: E) => V` | Called when a matching entity is updated. Returns the new value. |
| `onDelete`    | `(value: V, entity: E) => V` | Called when a matching entity is deleted. Returns the new value. |

---

## Contexts

| Context                 | Type                                | Default                 | Description                                                                                           |
| ----------------------- | ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `QueryClientContext`    | `Context<QueryClient \| undefined>` | `undefined`             | Signalium context for the `QueryClient`. Must be provided for `fetchQuery` and `getMutation` to work. |
| `NetworkManagerContext` | `Context<NetworkManager>`           | `defaultNetworkManager` | Signalium context for the `NetworkManager`.                                                           |

---

## Types

### Query types

| Type                            | Definition                                                                                                                | Description                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `QueryPromise<T extends Query>` | `DiscriminatedReactivePromise<QueryResult<T>>`                                                                            | The return type of `fetchQuery`. A reactive promise.                                                                       |
| `QueryResult<T extends Query>`  | `ExtractType<T['result']> & { __refetch(), __loadNext(), __hasNext, __isLoadingNext }`                                    | The resolved value of a query. Includes pagination helpers.                                                                |
| `QueryCacheOptions`             | `{ maxCount?: number; cacheTime?: number }`                                                                               | Persistent storage cache settings. `cacheTime` is in minutes (default: 1440 / 24 hours). `maxCount` is the LRU queue size. |
| `QueryConfigOptions`            | `{ gcTime?, staleTime?, debounce?, networkMode?, retry?, refreshStaleOnReconnect?, subscribe? }`                          | Instance-level query configuration. See property table below.                                                              |
| `QueryRequestOptions`           | `{ baseUrl?, credentials?, mode?, cache?, redirect?, referrer?, referrerPolicy?, integrity?, keepalive?, signal? }`       | Extended fetch options for individual queries.                                                                             |
| `QueryContext`                  | `{ fetch, baseUrl?, log?, evictionMultiplier? }`                                                                          | Context object provided to the `QueryClient`.                                                                              |
| `QueryParams`                   | `Record<string, string \| number \| boolean \| undefined \| null \| Signal<...> \| unknown[] \| Record<string, unknown>>` | The shape of query parameters at runtime.                                                                                  |
| `LoadNextConfig`                | `{ url?: unknown; searchParams?: Record<string, unknown> }`                                                               | Pagination configuration. Values can be FieldRefs.                                                                         |

#### `QueryConfigOptions` properties

| Property                  | Type                               | Default                     | Description                                                              |
| ------------------------- | ---------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `gcTime`                  | `number`                           | `5`                         | In-memory eviction time in minutes. `0` = next-tick, `Infinity` = never. |
| `staleTime`               | `number`                           | `0`                         | Milliseconds data is considered fresh. `0` = always stale.               |
| `debounce`                | `number`                           | `0`                         | Milliseconds to debounce param-change refetches.                         |
| `networkMode`             | `NetworkMode`                      | `NetworkMode.Online`        | When to allow fetching.                                                  |
| `retry`                   | `RetryConfig \| number \| boolean` | `3` (client) / `0` (server) | Retry configuration.                                                     |
| `refreshStaleOnReconnect` | `boolean`                          | `true`                      | Whether to refetch stale queries when network reconnects.                |
| `subscribe`               | `(onEvent) => () => void`          | —                           | Subscribe to external events that should trigger refetches.              |

### Mutation types

| Type                    | Definition                                                                                              | Description                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `MutationConfigOptions` | `{ retry?: RetryConfig \| number \| false }`                                                            | Mutation retry configuration.                                                                            |
| `MutationEffects`       | `{ creates?, updates?, deletes? }`                                                                      | Entity side effects of a mutation. Each is a `ReadonlyArray<readonly [EntityClassOrTypename, unknown]>`. |
| `MutationEvent`         | `CreateEvent \| UpdateEvent \| DeleteEvent`                                                             | Union of mutation event types.                                                                           |
| `CreateEvent`           | `{ type: 'create'; typename: string; data: Record<string, unknown>; id?: unknown }`                     | Entity creation event.                                                                                   |
| `UpdateEvent`           | `{ type: 'update'; typename: string; data: Record<string, unknown>; id?: unknown }`                     | Entity update event.                                                                                     |
| `DeleteEvent`           | `{ type: 'delete'; typename: string; data: string \| number \| Record<string, unknown>; id?: unknown }` | Entity deletion event. `data` can be just the ID.                                                        |

### Network types

| Type          | Definition                              | Description                                 |
| ------------- | --------------------------------------- | ------------------------------------------- |
| `NetworkMode` | `enum { Always, Online, OfflineFirst }` | Controls when queries are allowed to fetch. |

#### `NetworkMode` values

| Value                      | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `NetworkMode.Always`       | Always fetch regardless of network status.      |
| `NetworkMode.Online`       | Only fetch when online (default).               |
| `NetworkMode.OfflineFirst` | Fetch if cached data exists, even when offline. |

### Retry types

| Type          | Definition                                                           | Description                                                                     |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `RetryConfig` | `{ retries: number; retryDelay?: (attemptIndex: number) => number }` | Retry configuration. Default delay: exponential backoff (`1000ms * 2^attempt`). |

### Utility types

| Type                    | Definition                           | Description                                                                   |
| ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `TypeDef<T>`            | Branded phantom type                 | Represents a type definition in the public API.                               |
| `TypeDefShape`          | `Record<string, TypeDef> \| TypeDef` | A shape for query results or mutation params.                                 |
| `ExtractType<T>`        | Conditional type                     | Extracts the TypeScript type from a `TypeDef<T>`.                             |
| `ExtractQueryParams<T>` | Conditional type                     | Extracts the params type from a `Query` subclass.                             |
| `Draft<T>`              | Recursive mapped type                | Recursively removes `readonly` from all properties. Return type of `draft()`. |
| `ParseResult<T>`        | `ParseSuccess<T> \| ParseError`      | Result of `t.result()` parsing.                                               |
| `ParseSuccess<T>`       | `{ success: true; value: T }`        | Successful parse.                                                             |
| `ParseError`            | `{ success: false; error: Error }`   | Failed parse.                                                                 |

### Store types

| Type                 | Definition                                                                                                        | Description                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `QueryStore`         | Interface                                                                                                         | Storage backend interface. See [stores/sync](/api/stores-sync) and [stores/async](/api/stores-async). |
| `CachedQuery`        | `{ value: unknown; refIds: Set<number> \| undefined; updatedAt: number; preloadedEntities?: PreloadedEntityMap }` | Cached query data returned by `QueryStore.loadQuery()`.                                               |
| `PreloadedEntityMap` | `Map<number, Record<string, unknown>>`                                                                            | Pre-loaded entity data for hydration.                                                                 |
