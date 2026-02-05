# @signalium/query

## 1.1.1

### Patch Changes

- bb0a5a9: Fix entity proxies not being created for preloaded entities from cache, and `__entityRef` not being resolved in proxy get handler. This fixes validation errors when accessing nested entities loaded from persistent cache.

## 1.1.0

### Minor Changes

- af443c5: Add request body support to query() function

  Queries can now send JSON request bodies for POST requests, enabling read-like operations that require complex data structures (e.g., fetching prices for an array of tokens).

  **New features:**

  - Added `body` field to query definitions for specifying request body schema
  - Body parameters are automatically serialized as JSON with `Content-Type: application/json` header
  - Body params work alongside path params and search params
  - All query features (caching, staleTime, deduplication) work with body queries

  **API changes:**

  - Query methods are now restricted to `GET` and `POST` only (PUT, PATCH, DELETE should use `mutation()`)

  **Example:**

  ```typescript
  const getPrices = query(() => ({
    path: '/prices',
    method: 'POST',
    body: {
      tokens: t.array(t.string),
    },
    searchParams: {
      currency: t.string,
    },
    response: {
      prices: t.array(t.object({ token: t.string, price: t.number })),
    },
    cache: { staleTime: 30_000 },
  }));

  // Usage: POST /prices?currency=USD with body: {"tokens":["ETH","BTC"]}
  const result = getPrices({ tokens: ['ETH', 'BTC'], currency: 'USD' });
  ```

## 1.0.18

### Patch Changes

- 395730a: Fix entity cache keys to include shapeKey, preventing stale entity validation errors after schema changes

## 1.0.17

### Patch Changes

- b244daa: Fix infinite query cache hydration and Hermes Uint32Array compatibility

  - Fix Hermes (React Native) compatibility by spreading Set to Array before Uint32Array conversion, which prevents empty refIds buffers
  - Fix infinite query cache loading by properly handling the array of pages when parsing entities, ensuring entity proxies resolve correctly after app restart

## 1.0.16

### Patch Changes

- 4a3bc06: Fix union parseValue check

## 1.0.15

### Patch Changes

- a95ed74: Ensure entities have a unique prototype
- aa50869: Fix Record parsing and reorganize/expand parsing tests

## 1.0.14

### Patch Changes

- 7462836: Add mutation support
- 84265ca: Add API resilience features:
  - Array filtering for parse failures
  - Undefined fallback for optional types
  - `t.result` wrapper for handling and exposing parse errors directly
- f07ed0e: Add separate dev-mode and prod-mode builds
- 093cbb2: Add baseUrl and ability to override baseUrl + other request options
- Updated dependencies [f07ed0e]
  - signalium@2.1.6

## 1.0.13

### Patch Changes

- d2d633e: Ensure Entity methods can call other methods

## 1.0.12

### Patch Changes

- f3e1ef0: Fix case-insensitive enum type inference
- 11116da: Add more tests for shapeKey and fix some small issues
- 0219742: Fix initialization error handling
- Updated dependencies [985abb0]
  - signalium@2.1.5

## 1.0.11

### Patch Changes

- 7f94377: Fixup format registry and add global format type registry
- d1f9def: Add ability to defined cached methods to entities
- e0a4844: Add ability for Entities to subscribe to streams when in use
- 6b961f0: Add support for Signal query parameters and debounced updates
- Updated dependencies [2cf6766]
  - signalium@2.1.4

## 1.0.10

### Patch Changes

- 24495ac: Add t.enum.caseInsensitive()
- 047d4dc: Allow all primitive types in search params
- 9b2c2f3: Add extend to Entity and Object typedefs
- c8fc4b8: Allow typenames to be optional on entities
- 0245106: Add streamOrphans and optimisticInserts

## 1.0.9

### Patch Changes

- 9257412: Add t.optional/t.nullable/t.nullish
- Updated dependencies [7350348]
- Updated dependencies [c78b461]
  - signalium@2.1.2

## 1.0.8

### Patch Changes

- f76ade3: Add support for stream and infinite queries for useQuery results

## 1.0.7

### Patch Changes

- 82e7818: Add useQuery for reading query results. Calling `useReactive` on a query result
  will cause the result itself to entangle, but not the value of the result (e.g.
  the entities inside the result). This can lead to cases where the result is not
  re-rendered when the entities inside the result change. By cloning the result,
  we effectively reify it and force it to flatten, entangling all of the nested
  entities with that read from React.

## 1.0.6

### Patch Changes

- c883a52: Add no-op implementations of MemoryEvictionManager, RefetchManager, and NetworkManager for SSR environments. These can be injected into QueryClient constructor to avoid creating timers and event listeners in server-side rendering contexts.

## 1.0.5

### Patch Changes

- 00ae954: Signalium:

  - Add support for Sets, Maps, and Dates in the `hashValue` function
    - Note: This may cause some _minor_ differences in reactive functions that receive these types as parameters, they should essentially run less often in those cases. The impact of this should be minimal, so we're not considering it a breaking change.

  Query:

  - Add shape checking to make sure that if the shape of a query is changed, the query key will change as well, preventing stale data with a different shape from being returned from the query store
  - Fix an issue where shrinking the `maxCount` of a query would cause an error when trying to activate the query

- Updated dependencies [00ae954]
  - signalium@2.1.1

## 1.0.4

### Patch Changes

- e202f05: Fix package.json main export

## 1.0.3

### Patch Changes

- cfe249d: Export QueryClientContext

## 1.0.2

### Patch Changes

- 5f34de3: Add exports for entity and registerFormat

## 1.0.1

### Patch Changes

- 39d3df8: Export type definitions for queries

## 1.0.0

### Minor Changes

- 1a94943: Add NetworkManager and network mode options
- 0f609e4: Adds infinite query, includes some minor breaking API changes
- 4c35e93: Add Stream Query support
- f59a776: Add async store and split out stores into separate import paths

### Patch Changes

- Updated dependencies [e64597d]
- Updated dependencies [4c35e93]
  - signalium@2.1.0

## 0.1.0

### Minor Changes

- 919ecd9: Remove unused decoders dependency and prepare for initial pre-release

## 0.0.2

### Patch Changes

- 6eddfdc: Adds `staleTime`, `gcTime`, and `refetchInterval` options to queries.
- Updated dependencies [6eddfdc]
  - signalium@2.0.9

## 0.0.1

### Patch Changes

- e6c39ee: Initial Signalium Query release
- Updated dependencies [e6c39ee]
  - signalium@2.0.7
