# @signalium/query

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
