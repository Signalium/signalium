## EntityStore Design & Execution Plan

### Goals

- **Normalized key–value store** for parsed entities and queries.
- **Set semantics**: `set(entity)` updates only that entity; do not auto-update its children. The parser is responsible for setting children separately as it continues parsing.
- **Persistence**: Storage is backed by a pluggable API capable of get/set/delete for JSON values.
- **Queries as roots**: Queries are stored in a normalized manner and act as ultimate consumers of entities.
- **Consumer counts**: Each entity tracks how many direct consumers it has. Queries are the ultimate consumers; entities may also consume other entities.
- **Cascading cleanup**: On query update or eviction, adjust consumed counts of referenced entities. If any reaches zero, remove it and recursively decrement counts of the entities it consumes.
- **LRU per query type**: Maintain an LRU cache per query type keyed by query id. Track last item pointer and count; if capacity is exceeded, evict the last.

### High-level Architecture

- The store persists three normalized maps:

  - **Entities**: `entity:{type}:{id}` → `{ value: JSON, consumerCount: number, consumes: EntityKey[] }`
  - **Queries**: `query:{type}:{id}` → `{ value: JSON, consumes: EntityKey[] }`
  - (Optional) **Metadata**: versioning, migration markers, etc.

- The store also maintains in-memory indexes:
  - **LRU per query type**: `{ [queryType: string]: DoublyLinkedList<queryId> }` with an O(1) id→node map, `tail` pointer (last item), `head` pointer (first item), and `size`.
  - **Config**: `{ maxCacheSizeByQueryType?: Record<string, number> }`.

### Data Model

- **EntityKey**: `{ type: string; id: string }` with canonical string key `entity:${type}:${id}`.
- **QueryKey**: `{ type: string; id: string }` with canonical string key `query:${type}:${id}`.
- **EntityRecord**:
  - `value: unknown` (JSON-serializable)
  - `consumerCount: number` (direct consumers only)
  - `consumes: EntityKey[]` (entities this entity directly references; used only for cascading deletes)
- **QueryRecord**:
  - `value: unknown` (JSON-serializable)
  - `consumes: EntityKey[]` (entities this query directly references)

Notes:

- Consumer counts are mutated only when queries change or are evicted. Entity sets do not modify counts; they merely persist `value` (and optionally `consumes` for cascading purposes), deferring count math to query updates.
- Cascading deletes traverse "down" edges via `consumes` lists.

### Persistence API (injected)

The store is constructed with a persistence adapter that abstracts durable storage. Minimal interface:

```ts
interface PersistentKV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  // Optional optimizations
  mget?<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
  mset?<T = unknown>(entries: Array<{ key: string; value: T }>): Promise<void>;
  mdelete?(keys: string[]): Promise<void>;
  // Optional transactional boundary; if unavailable we use best-effort ordering
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}
```

The adapter stores JSON-serializable values. If `transaction` is provided, we wrap multi-key updates (e.g., query install/evict) to maintain atomicity of counts and records.

### Public API (EntityStore)

```ts
type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

interface EntityRef {
  type: string;
  id: string;
}

interface EntityStoreOptions {
  kv: PersistentKV;
  maxCacheSizeByQueryType?: Record<string, number>; // default 0 (no LRU) per type if absent
}

class EntityStore {
  constructor(options: EntityStoreOptions);

  // Entities
  setEntity(ref: EntityRef, value: JSONValue, consumes?: EntityRef[]): Promise<void>; // does not change counts
  getEntity(ref: EntityRef): Promise<JSONValue | undefined>;
  hasEntity(ref: EntityRef): Promise<boolean>;

  // Queries
  setQuery(ref: EntityRef /* query type/id */, value: JSONValue, consumes: EntityRef[]): Promise<void>;
  getQuery(ref: EntityRef): Promise<JSONValue | undefined>;
  hasQuery(ref: EntityRef): Promise<boolean>;
  evictQuery(ref: EntityRef): Promise<void>; // triggers count decrements and cascading deletions

  // LRU
  touchQuery(ref: EntityRef): void; // promote to MRU; called by get/setQuery
}
```

### Core Behaviors

#### Setting an entity

- Persist `EntityRecord` at `entity:{type}:{id}` with provided `value` and optional `consumes`.
- Do not mutate `consumerCount` (preserve existing count; default 0 if new).
- Do not walk children; parser is responsible for also setting the entities referenced by `consumes` as separate operations.

#### Installing/updating a query

- Read existing `QueryRecord` (if any) to get `prevConsumes`.
- Persist `QueryRecord` with new `value` and `consumes`.
- Compute set diff:
  - `added = consumes − prevConsumes`
  - `removed = prevConsumes − consumes`
- For each `added` entity: increment its `consumerCount` by 1; persist.
- For each `removed` entity: decrement its `consumerCount` by 1; if count reaches 0, delete it and cascade (see below).
- Update LRU for the query type (promote to MRU; possibly evict tail if over capacity).
- Prefer to wrap the above in a transaction if the adapter supports it.

#### Evicting a query (explicit or via LRU)

- Read the `QueryRecord` to get its `consumes` list.
- Delete the query record.
- For each consumed entity: decrement `consumerCount`; if it reaches 0, delete the entity and cascade.
- Update LRU structures (remove node; adjust size and tail/head as needed).

#### Cascading delete

- When an entity `E` is removed due to `consumerCount` reaching 0:
  1. Read `E.consumes`.
  2. Delete `E`.
  3. For each entity `C` in `E.consumes`:
     - Decrement `C.consumerCount`.
     - If `C.consumerCount` reaches 0, repeat recursively for `C`.

Notes:

- Only direct consumer counts are stored; cascades traverse down the `consumes` edges.
- Entity updates (via `setEntity`) do not affect counts.

### LRU Cache per Query Type

- For each query `type`, maintain an in-memory doubly-linked list with:
  - `head` (MRU), `tail` (LRU/last item), `size`, `capacity` (from config), and a map `id→node`.
- On `getQuery`/`setQuery`/`touchQuery`:
  - If node exists, move to `head`.
  - If new, create node at `head`, increment `size`.
  - If `size > capacity`, evict `tail` (call `evictQuery` for that id) and update `tail` pointer and `size`.
- The spec requires a pointer to the last item and the current size; we will also track `head` for O(1) promotion.
- LRU state is memory-only (non-persistent) by default. See open questions.

### Complexity Targets

- `setEntity`: O(1) persistence; O(k) if writing `consumes` with k entries.
- `setQuery`: O(a + r + log(1)) ≈ O(a + r) for added/removed refs; O(1) LRU updates.
- `evictQuery`: O(c) for consumed entities; O(1) LRU updates.
- `cascadeDelete`: O(total entities traversed).

### Failure & Consistency

- If `transaction` exists, wrap multi-step updates to avoid partial count diverge.
- Without transactions, operations are ordered to keep store mostly-consistent; on crash mid-operation, counts may temporarily diverge. Recovery strategies (optional):
  - On boot, scan queries and recompute counts from `consumes`.
  - Or store an operation journal to replay.

### Edge Cases

- Re-setting an entity without `consumes`: preserve existing `consumes` unless explicitly clearing.
- Queries with duplicate refs: deduplicate before diffing.
- Negative counts are prevented by clamping at 0 and logging diagnostics.
- Entities may be referenced by multiple query types and queries.

### Telemetry & Debuggability (optional but recommended)

- Toggleable debug logging for count increments/decrements, cascade paths, and evictions.
- Introspection methods: dump counts for an entity, list of consumers, and query LRU snapshots.

### Implementation Plan

1. Define types/interfaces: `EntityRef`, `EntityRecord`, `QueryRecord`, `PersistentKV`, configuration.
2. Implement key encoders/decoders: `toEntityKey`, `toQueryKey`.
3. Implement persistence helpers: get/set/delete entity/query records with schema defaults.
4. Implement LRU structure per query type with O(1) ops and capacity enforcement.
5. Implement core API:
   - `setEntity`
   - `setQuery` with diffing and count updates
   - `evictQuery` with cascading delete
   - `getEntity`, `getQuery`, `hasEntity`, `hasQuery`, `touchQuery`
6. Add optional transaction wrapper around multi-step operations.
7. Add tests:
   - Setting entities does not alter counts
   - Query install increments counts (added), decrements counts (removed)
   - Evict query decrements counts and cascades
   - Cascade deletion removes deep chains
   - LRU promotes on access and evicts over capacity
   - Idempotency and deduplication
8. Add diagnostics (optional): debug logs and introspection.

### Assumptions

- Parser is authoritative for determining `consumes` lists for queries and entities.
- Only query operations change consumer counts. Entity updates do not.
- Cascading deletion traverses via `consumes` (downstream dependencies), not via back-references.
- LRU is in-memory and not persisted. On process restart, LRU state is rebuilt lazily as queries are accessed.

### Open Questions for Clarification

- Should LRU promotion occur on both `getQuery` and `setQuery`, or only on `setQuery`?
- Should LRU state persist across sessions (e.g., persisted order), or is in-memory sufficient?
- Confirm that entity `consumes` should be recorded at `setEntity` time purely for cascading deletion, but should not trigger count changes by themselves.
- Should we support a batch API for installing a query and its entities in one transactional call from the parser?
- Error handling policy for missing entities referenced by a query: ignore, auto-create with count 0, or fail?
- Are there query-to-query dependencies, or are queries always roots only?
- Maximum default LRU capacity per query type if unspecified? (e.g., 0=no limit, 100, etc.)

### Non-Goals (for now)

- Cross-tab synchronization of counts and LRU across multiple runtimes.
- Conflict resolution for concurrent writers without transactional storage.
- Versioned entities or time-travel.

### Example Key Shapes

- Entity key: `entity:user:123`
- Query key: `query:UserById:123`

### Example Flows (informal)

1. Install query Q referencing A and B (A consumes C):

- Set entities A, B, C with values and `consumes` (A.consumes=[C]).
- setQuery(Q, value, consumes=[A, B]): increment counts(A, B).
- LRU touch Q.

2. Update query Q to reference only B:

- setQuery(Q, value2, consumes=[B]): decrement counts(A) → 0 → delete A → decrement counts(C) → maybe 0 → delete C.
- LRU touch Q.

3. LRU eviction of query Q when capacity exceeded:

- evictQuery(Q): decrement counts of its entities and cascade; remove Q; adjust LRU tail/size.

### Testing Plan

Test framework: Vitest (repo already uses it). Use `InMemoryKV` for default persistence, and add targeted tests for adapters that support `transaction` vs. those that do not (simulated by omitting it).

- Unit test scaffolding

  - **Helpers**: build `ref(type,id)` for `EntityRef`, `entRec(value, consumes, consumerCount)` factory, and `setup(capacityByType?)` that returns a fresh `EntityStore` with `InMemoryKV`.
  - **Fixtures**: simple entity graphs: A→[C], B (no children), C (no children), D→[E, F], E, F.

- Entities behavior

  - **setEntity does not modify counts**: set A with consumes [C]; assert A.consumerCount remains 0; C unaffected.
  - **get/has entity**: set then get/has; nonexistent returns undefined/false.
  - **preserve count on overwrite**: set A, then set A with new value and consumes; verify count unchanged.

- Queries install/update

  - **install increments counts**: set A, B, then setQuery Q consumes [A, B]; assert A.count=1, B.count=1.
  - **update diffing**: Q from [A, B] → [B]; A decremented to 0 and deleted; B remains 1.
  - **idempotency**: setQuery Q with same consumes twice; counts remain stable (no double-increment).
  - **deduplication**: setQuery with duplicate refs [A, A, B]; counts A=1, B=1.

- Query eviction

  - **explicit evict**: install Q [A]; evictQuery(Q); A count→0, A deleted; cascades as needed.
  - **LRU-triggered evict**: capacity=1 for type T; setQuery Q1, then Q2; Q1 evicted, counts adjusted.

- Cascading delete

  - **single-level**: A consumes [C]; Q consumes [A]; update Q to []; expect A and C removed.
  - **multi-level chain**: A→B→C, Q consumes [A]; removing Q deletes A, decrements B then C, both removed when counts hit 0.
  - **shared child**: A→[C], B→[C], Q1 consumes [A], Q2 consumes [B]; evict Q1 keeps C (count from B path), evict Q2 then removes C.

- LRU per query type

  - **promotion on get/set**: confirm `touchQuery` runs via `getQuery` and `setQuery` by observing eviction order after accesses.
  - **per-type isolation**: capacity per type; ensure evictions for type T do not affect type U.
  - **last pointer/size correctness**: after a series of touches/evictions, assert `size` and `last` match expectations.

- Transactional consistency

  - **with transaction**: wrap kv in an adapter providing `transaction`; during `setQuery`, assert that if an injected failure occurs inside the transaction (throw), all changes are rolled back (query not persisted, counts unchanged).
  - **without transaction**: simulate failure after query persisted but before count updates; on next startup (optional utility), recompute counts from queries (if recovery tool exists) or assert partial state is acceptable per assumptions.

- Error/edge handling

  - **missing entity in consumes**: setQuery referencing entity not present; increment creates a placeholder record with count=1 and value=null; subsequent setEntity fills value but does not disrupt count.
  - **negative count clamping**: multiple removals cannot drive counts below 0.
  - **empty consumes**: installing query with [] removes prior references, no residual entities.
  - **large consumes**: performance sanity (non-exhaustive): install query with 1k entities; ensure operation completes and counts are correct.

- API invariants

  - **touch side-effects**: `getQuery` touches LRU but does not change store contents.
  - **hasQuery/hasEntity**: do not mutate LRU or counts.
  - **get non-existent query**: returns undefined and does not create LRU entries.

- Optional property tests (if time permits)

  - Generate random DAGs of entities and random query consume sets; after arbitrary sequences of installs/updates/evictions, assert: (1) counts equal number of queries (and entities) that directly consume each entity; (2) no entity exists with count=0; (3) removing all queries removes all entities.

- Concurrency simulation (coarse)

  - Interleave `setQuery` and `evictQuery` on different queries referencing overlapping entities; assert final counts match expected math; verify no negative counts and no orphaned zero-count entities.

- Snapshot/inspection (if debug hooks added)
  - Use debug dumps to snapshot LRU and entity maps before/after operations to assert structural correctness without relying on internal private fields.

### Parser Integration & Execution Plan

What exists in `packages/query/src/parser.ts`:

- **Validator framework**: `Validator<T>` with `parse`/`serialize`, nullable/optional/nullish wrappers, and primitive/object/array/tuple/record combinators. Also `entity(...)` helper to declare entity-shaped validators and `schema(...)`, `query(...)`, `mutation(...)` placeholders.
- **ParseContext** skeleton:
  - `shouldStoreEntities: boolean`
  - `errors: ValidationError[]`
  - `entityStore: EntityStore`
  - `formatRegistry`
  - `config: { getEntityKey(entity: Record<string, unknown>): string }`
- A minimal `EntityStore` interface in `parser.ts` (string-keyed get/set) used as a placeholder.

What is needed to finish the parser and integrate with the new `EntityStore`:

- **Adopt the new store API**: Replace the local `EntityStore` placeholder with imports from `src/entity-store.ts` and `src/persistence.ts` (`EntityStore`, `EntityRef`, `JSONValue`). The parser must call:

  - `setEntity(ref, value, consumes)` for every encountered entity.
  - `setQuery(ref, value, consumes)` once per query response.

- **Entity identification**:

  - Use `config.getEntityKey` to compute a unique id for any object validated by an `entity(...)` validator. Split the id into `(type, id)`; or extend config to return `{ type, id }`. If only a single string is returned, define parsing rules (e.g., `"type:id"`).
  - Create `EntityRef { type, id }` and record it.

- **Graph extraction (consumes edges)**:

  - During parsing, whenever an `entity(...)` validator successfully parses an object `E`, record:
    - `ERef = { type, id }` for `E`.
    - `EConsumes: EntityRef[]` containing direct child entities encountered while parsing `E`’s fields.
  - Maintain a traversal stack and a `seen` set (by entity key) to avoid cycles and duplicate processing.

- **Accumulation**:

  - Build an in-memory map `entityKey → { value: JSONValue, consumes: EntityRef[] }` for all entities found in the response payload.
  - Build `queryConsumes: EntityRef[]` for top-level entities referenced directly by the query result (roots from this response).

- **Persistence**:

  - If `ParseContext.shouldStoreEntities` is true and there are no validation errors, persist:
    1. `setEntity` for each entity map entry (value as plain JSON; not proxies/signals), with its `consumes`.
    2. `setQuery` for the query ref and payload (also plain JSON), with `queryConsumes`.
  - If the underlying KV supports transactions, optionally wrap the whole write (entities then query) in `kv.transaction` via `EntityStore` orchestration.

- **Validation and errors**:

  - Accumulate `errors` during validation; if non-empty, do not write to the store.
  - Provide clear `path` information in `ValidationError` as traversals descend.

- **LRU**: No direct parser interaction is required; `EntityStore.setQuery` triggers LRU updates.

- **Serialization**:

  - Parsers should produce plain JSON-serializable data for the store. If runtime objects (e.g., Dates via formatters) are produced during parsing, ensure a serializer is available if persisted, or convert to a JSON representation prior to `setEntity`/`setQuery`.

- **API surface additions for parser**:
  - `ParseContext.config.getEntityRef?: (value: Record<string, unknown>) => EntityRef` preferred over string key; keep `getEntityKey` as a fallback for backwards compatibility.
  - Optional `onEntity?(ref: EntityRef, value: JSONValue): void` hook for instrumentation/testing.

Implementation steps in `parser.ts`:

1. Replace the local `EntityStore` interface with imports from the new implementation and update `ParseContext` types accordingly.
2. Extend configuration to accept `getEntityRef` (or encode/decode of string keys into `{ type, id }`).
3. Instrument `Validator` combinators to propagate entity discovery context:
   - `entity(...)` must: (a) detect `EntityRef`, (b) push/pop an entity collection frame, (c) return parsed value while recording child entity refs found during recursive parsing of its fields.
4. Implement traversal helpers:
   - `collectEntities(value, validator, ctx): { entities: Map<string, { value, consumes }>, roots: EntityRef[] }`.
   - Use a `seen` set keyed by `entity:${type}:${id}` to avoid re-parsing duplicates in the same payload.
5. Implement `parseQuery(queryRef, validator, response, ctx)`:
   - Validate and collect entities/roots.
   - If `shouldStoreEntities` and no `errors`, persist via `EntityStore` (entities first, then query) in a transaction if available.
6. Ensure `getQuery`/`getEntity` are not used by the parser during writing; the parser should be write-only to avoid accidentally hydrating stale values.
7. Add tests per Testing Plan for parser integration flows (entity detection, consumes extraction, store writes, and error cases).

Open questions for parser:

- Should `getEntityKey` definitively encode both `type` and `id`? If not, provide another config `getEntityRef` returning both.
- Should parsed values be stored exactly as parsed (possibly with Date objects) or JSON-serialized first? Current store assumes JSON values.
- How to handle entities discovered multiple times within the same query result (first write wins vs. must be identical)? We will deduplicate and prefer the first encountered value for now.
