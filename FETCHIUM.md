# Fetchium — detailed architecture

Data-fetching and entity management layer built on signalium. Lives in `packages/fetchium/`.

## Entry points

| Import path             | Source                                              |
| ----------------------- | --------------------------------------------------- |
| `fetchium`              | `src/index.ts`                                      |
| `fetchium/react`        | `src/react/index.ts` (exports `useQuery`)           |
| `fetchium/stores/sync`  | `src/stores/sync.ts` (sync query store)             |
| `fetchium/stores/async` | `src/stores/async.ts` (async/IndexedDB query store) |

## Key source files

| File                       | Purpose                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query.ts`                 | `Query` base class, `getQuery()`, `QueryDefinition`                                                                                                                               |
| `QueryResult.ts`           | `QueryInstance` — manages a single query's lifecycle (relay, fetch, cache, refetch). Creates the persistent query proxy.                                                          |
| `QueryClient.ts`           | `QueryClient` — central coordinator. Manages query instances, entity store, cache operations, context. `QueryClientContext` for DI.                                               |
| `proxy.ts`                 | `Entity` base class, `createEntityProxy()` — Proxy-based entity objects with lazy parsing, `notifier.consume()` on access, method wrapping. Also `parseValue()`, `mergeValues()`. |
| `parseEntities.ts`         | Entity extraction during response parsing — normalizes entities into the store, replaces with `__entityRef` references.                                                           |
| `EntityMap.ts`             | `PreloadedEntityRecord` type, entity store data structures, deep clone for optimistic updates.                                                                                    |
| `typeDefs.ts`              | `t` type DSL (`t.string`, `t.entity()`, `t.array()`, `t.union()`, etc.), `ValidatorDef` class, `reifyShape()` which computes `subEntityPaths`.                                    |
| `types.ts`                 | TypeScript types: `Mask` enum (bitmask for type checking), `EntityDef`, `ObjectDef`, `QueryResult<T>`, `QueryPromise<T>`.                                                         |
| `mutation.ts`              | `Mutation` base class, `getMutation()`                                                                                                                                            |
| `NetworkManager.ts`        | Online/offline detection via signal                                                                                                                                               |
| `MemoryEvictionManager.ts` | Schedules query eviction after deactivation                                                                                                                                       |
| `RefetchManager.ts`        | Periodic refetch for stale queries                                                                                                                                                |

## Entity system

Entities are normalized: each unique `(typename, id, shapeKey)` maps to one `PreloadedEntityRecord` in the entity store.

```
PreloadedEntityRecord {
  key: number            // hash of [typename:id, shapeKey]
  data: Record<string, unknown>  // raw parsed data
  notifier: Notifier     // fires when data changes (equals: () => false)
  cache: Map<PropertyKey, any>   // parsed property cache (cleared on data change)
  proxy: Record<string, unknown> // identity-stable Proxy (created once)
  entityRefs: Set<number>        // keys of child entities referenced by this entity
}
```

The entity proxy (`createEntityProxy`):

1. On property access: calls `notifier.consume()` (reactive tracking), activates relay if present, parses/caches the value
2. Handles `__entityRef` hydration for nested entities loaded from cache
3. Wraps methods via `reactiveMethod()`
4. Implements `CONSUME_DEEP` using `subEntityPaths` (pre-computed list of entity-typed property keys) for efficient deep traversal with cycle protection

## Query lifecycle

1. `getQuery(QueryClass, params)` → gets/creates a `QueryInstance` (memoized by query key)
2. `QueryInstance` creates a `relay()` that manages the query subscription
3. On activation: loads from cache, then fetches if stale, sets up refetch intervals and stream subscriptions
4. Data is parsed via `parseEntities()` which normalizes entities into the store and returns proxied objects
5. For object-shaped responses, a persistent query proxy (`createQueryProxy`) is created once; updates swap the underlying `_data` and fire `_notifier`
6. The query proxy also implements `CONSUME_DEEP` — consumes `_notifier` and chains to entity CONSUME_DEEP

## `subEntityPaths`

During `reifyShape()` in `typeDefs.ts`, each object/entity definition collects property keys whose type includes `Mask.ENTITY | Mask.HAS_SUB_ENTITY`. Stored as:

- `undefined` — no entity-typed properties
- `string` — exactly one (avoids array allocation)
- `string[]` — multiple

Used by both `parseEntities()` (to skip non-entity properties during parsing) and entity `CONSUME_DEEP` (to skip non-entity properties during deep tracking).

## Test setup

- Unit tests: `src/__tests__/` — use `createMockFetch()` from `utils.ts`, `SyncQueryStore` with `MemoryPersistentStore`
- React tests: `src/react/__tests__/` — use `vitest-browser-react`, `ContextProvider` with `QueryClientContext`
- Vitest config aliases `signalium` to the sibling package's source (not dist)
- The signalium Babel preset is applied in `vitest.config.ts` for async transform support
