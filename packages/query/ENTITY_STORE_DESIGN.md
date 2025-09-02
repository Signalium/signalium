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
