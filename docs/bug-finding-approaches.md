# Bug-Finding Approaches for Signalium

## Context

This document outlines systematic approaches for finding bugs in the signalium reactive framework. It covers the full stack: core signalium (signals, reactive, async, relays, watchers), the @signalium/query package, and React integration.

### What Has Already Been Done

The following approaches have been executed and produced results. Test files are in `packages/signalium/src/__tests__/`:

| Approach | Files Created | Bugs Found |
|----------|--------------|------------|
| Cross-framework test mining (Preact, Vue, SolidJS, TC39 polyfill, js-reactivity-benchmark) | `cross-framework-graph-topology.test.ts`, `cross-framework-dynamic-deps.test.ts`, `cross-framework-equality-pruning.test.ts`, `cross-framework-error-handling.test.ts`, `cross-framework-stress.test.ts` | 2 (error caching, error leak through checkSignal) |
| Ecosystem bug pattern reproduction (MobX, TanStack Query, Vue, Preact GitHub issues) | `ecosystem-bug-patterns.test.ts` | 1 (watcher removal loses async result) |
| Async concurrency edge cases | `async-concurrency-edge-cases.test.ts` | 4 (settled() gap, deep async pending x3) |
| API interaction analysis (cross-API shared state mapping) | `api-interaction-bugs.test.ts` | 0 (21 tests, all pass — validates API interactions work) |

**Total: 150+ tests, 5 unique bugs found (documented as `test.fails`).**

### Known Bugs Found

See `docs/bugs-found.md` for full details. Summary:

1. **Error caching missing** — Throwing computed recomputes every read (PR #192)
2. **Error leaks through checkSignal** — Bypasses consumer's try/catch (PR #193)
3. **`settled()` premature return** — Doesn't wait for async work (PR #194)
4. **Deep async chain permanently pending** — depth >= 3 with concurrent notifier+signal (PR #195)
5. **Watcher removal data loss** — Mid-flight async result lost (PR #196)

---

## Approach 1: Property-Based Testing with fast-check

### What It Does
Uses [fast-check](https://github.com/dubzzz/fast-check) to generate arbitrary reactive graph topologies and mutation sequences, then asserts behavioral invariants. The key advantage over the existing fuzzer is **automatic shrinking** — when it finds a failure, it reduces the input to the smallest case that still fails.

### How to Implement

1. Install fast-check: `npm install --save-dev fast-check` in `packages/signalium`
2. Create `packages/signalium/src/__tests__/property-based.test.ts`
3. Define arbitraries:
   - `arbSignalGraph`: generates a DAG of signal/reactive/relay nodes with random topology
   - `arbMutationSequence`: generates a sequence of `[signalWrite, notifierFire, watcherAdd, watcherRemove, sleep]` actions
   - `arbAsyncPattern`: generates sync/async/mixed patterns with random delay distributions
4. Define properties:
   - **Eventual consistency**: After all mutations and sufficient wait time, all watched computeds have resolved values matching manual computation
   - **No permanent pending**: No `ReactivePromise` is stuck with `isPending === true` after 5 seconds
   - **Glitch-free**: Watcher-observed values are always consistent snapshots (never see partially-updated diamond)
   - **Idempotent reads**: Reading the same computed twice without intervening mutations returns the same value
   - **Pruning correctness**: If a computed's dependencies haven't changed their output values, the computed doesn't recompute

### Expected Yield
High — automatic shrinking will find minimal reproduction cases for timing-dependent bugs that random fuzzing misses.

---

## Approach 2: Mutation Testing with Stryker

### What It Does
Systematically mutates signalium's source code (flip conditionals, remove statements, change `===` to `!==`, swap `<` with `<=`, etc.) and runs the existing test suite against each mutant. **Surviving mutants** — mutations that don't cause any test to fail — reveal untested code paths.

### How to Implement

1. Install Stryker: `npm install --save-dev @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker`
2. Create `packages/signalium/stryker.conf.json`:
   ```json
   {
     "mutate": ["src/internals/**/*.ts", "!src/**/*.test.ts"],
     "testRunner": "vitest",
     "checkers": ["typescript"],
     "reporters": ["html", "clear-text"],
     "coverageAnalysis": "perTest",
     "timeoutMS": 30000
   }
   ```
3. Run: `npx stryker run`
4. Focus analysis on surviving mutants in these high-risk files:
   - `src/internals/get.ts` (checkSignal, runSignal)
   - `src/internals/scheduling.ts` (flushWatchers, settled)
   - `src/internals/async.ts` (ReactivePromiseImpl, _setPending, _clearPending)
   - `src/internals/dirty.ts` (dirtySignal, propagateDirty)
   - `src/internals/watch.ts` (watchSignal, unwatchSignal, deactivateSignal)

### Expected Yield
Medium — finds test coverage gaps rather than bugs directly, but surviving mutants in critical paths often indicate real bugs hiding behind untested conditions.

---

## Approach 3: Static Analysis and Type-Level Bugs

### What It Does
Analyzes the source code without running it to find potential issues: unchecked null dereferences, Map/Set mutation during iteration, WeakRef use without deref checks, and type-unsafe casts.

### How to Implement

1. **TypeScript strict mode audit**:
   - Check `tsconfig.json` for `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
   - Run `tsc --noEmit --strict` and review any new errors
   - Search for `as any`, `as unknown`, `!` (non-null assertion) — each is a potential runtime null/type error

2. **WeakRef safety audit**:
   - Search for all `WeakRef` usage: `rg "WeakRef" packages/signalium/src/internals/`
   - For each `.deref()` call, verify the result is checked for `undefined` before use
   - The `StateSignal._subs` Map uses `WeakRef<ReactiveSignal>` as keys — verify iteration handles GC'd entries

3. **Collection mutation during iteration**:
   - Search for patterns where a `Map`/`Set` is iterated and modified in the same loop
   - Key files: `signal.ts` (notify clears `_subs`), `get.ts` (disconnectSignal iterates `deps`), `scheduling.ts` (flushWatchers swaps queue references)

4. **Dead code detection**:
   - Run `npx ts-prune` to find unexported/unused functions
   - Check for unreachable branches in state machines (e.g., `ReactiveFnState` enum combinations that never occur)

### Expected Yield
Medium — finds latent bugs and code quality issues. The WeakRef audit is most likely to find real bugs (race between deref and GC).

---

## Approach 4: Concurrency Model Checking

### What It Does
Models the scheduler as a state machine and exhaustively enumerates all possible interleavings of events to find ordering bugs.

### How to Implement

The scheduler in `src/internals/scheduling.ts` has 5 queues that interact:
```
PENDING_PULLS, PENDING_ASYNC_PULLS, PENDING_DEACTIVE, PENDING_LISTENERS, PENDING_GC
```

Model the system as a set of events that can occur in any order:
- `signalWrite(id, value)` — triggers `dirtySignal` → `schedulePull`
- `notifierFire(id)` — triggers `dirtySignal` → `schedulePull` or `scheduleAsyncPull`
- `asyncResolve(id, value)` — relay/promise resolves → `_setValue` → `scheduleAsyncPull`
- `watcherAdd(id)` — `watchSignal` → `activateSignal`
- `watcherRemove(id)` — `unwatchSignal` → `scheduleDeactivate`
- `gcSweep()` — `requestIdleCallback` fires
- `microtask()` — `flushWatchers` loop iteration
- `listenerCallback()` — listener fires, potentially writes signals (re-entrant)

Write a TypeScript exhaustive simulator that:
1. Creates a small graph (2-3 signals, 2-3 computeds, 1-2 watchers)
2. Generates all permutations of 3-4 events from the list above
3. For each permutation, simulates the scheduling behavior
4. Checks invariants after each permutation completes

### Expected Yield
High for specific bug patterns — exhaustive enumeration catches edge cases that random sampling misses. But limited to small graphs due to combinatorial explosion.

---

## Approach 5: Memory Leak Detection

### What It Does
Verifies that reactive nodes are properly garbage collected when no longer referenced, and that the GC sweep mechanism actually works.

### How to Implement

1. **GC correctness tests** (`packages/signalium/src/__tests__/memory-leaks.test.ts`):
   ```typescript
   // Run with: node --expose-gc
   test('reactive signal is GC\'d after losing all watchers', async () => {
     let ref: WeakRef<object>;
     const src = signal(0);

     // Create scope that will be GC'd
     {
       const derived = reactive(() => src.value * 2);
       ref = new WeakRef(derived);
       const w = watcher(() => derived());
       const unsub = w.addListener(() => {});
       unsub(); // remove watcher
     }

     global.gc!();
     await sleep(100);
     global.gc!();

     expect(ref.deref()).toBeUndefined();
   });
   ```

2. **`requestIdleCallback` audit**:
   - `scheduleGcSweep` uses `requestIdleCallback` which may not exist in Node.js test environment
   - Check the fallback: `typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb) => _scheduleFlush(cb)`
   - Verify the fallback actually runs in the test environment

3. **Map/Set size tracking**:
   ```typescript
   test('no growing maps after repeated create/destroy cycles', () => {
     for (let i = 0; i < 1000; i++) {
       const s = signal(i);
       const d = reactive(() => s.value);
       const w = watcher(() => d());
       const unsub = w.addListener(() => {});
       d(); // evaluate
       unsub(); // cleanup
     }
     // Check internal map sizes haven't grown unboundedly
   });
   ```

4. **Relay leak detection**:
   - Create a relay, watch it (activates), unwatch (deactivates), repeat 1000 times
   - Verify subscribe count equals unsubscribe count
   - Verify no dangling `_stateSubs` or `_awaitSubs` entries

### Expected Yield
High — GC behavior is almost entirely untested outside of the existing `gc.test.ts` which only covers basic scenarios. The `requestIdleCallback` fallback behavior in Node.js is especially suspect.

---

## Approach 6: Real Application Simulation

### What It Does
Builds a realistic mini-application using signalium's full API surface and runs scripted user/server event sequences.

### How to Implement

Build a "chat app" model:
```typescript
// Signals: current user, messages, typing indicators
const currentUser = signal({ id: 1, name: 'Alice' });
const messages = signal<Message[]>([]);
const typingUsers = signal<Set<number>>(new Set());

// Relay: WebSocket connection
const ws = relay(state => {
  const connection = connectWebSocket();
  connection.onmessage = (msg) => { state.value = msg; };
  return { deactivate: () => connection.close() };
});

// Context: auth token
const authCtx = context('');

// Reactive: filtered messages
const filteredMessages = reactive(async () => {
  const token = getContext(authCtx);
  const allMsgs = messages.value;
  return allMsgs.filter(m => m.visible);
});

// Watcher: notification side effect
const notificationWatcher = watcher(() => {
  const msgs = filteredMessages();
  // trigger notification for new messages
});
```

Script sequences:
1. User logs in (context change) → messages load (async) → WebSocket connects (relay)
2. New message arrives via WebSocket while messages are loading
3. User switches accounts (context change) mid-fetch
4. WebSocket disconnects and reconnects while messages are being rendered
5. Rapid message sending while previous sends are in-flight
6. User logs out (remove all watchers) while async operations are pending

### Expected Yield
Medium — finds integration bugs that synthetic tests miss, but requires more setup. Most valuable for discovering unexpected interactions between context, relay, and async reactive.

---

## Approach 7: Differential Testing Against Preact Signals

### What It Does
Implements the same reactive computation in both signalium and Preact Signals (or TC39 polyfill), feeds both the same mutation sequence, and compares outputs. Any divergence is either a bug or a documented behavioral difference.

### How to Implement

1. Install reference: `npm install --save-dev @preact/signals-core`
2. Create a translation layer:
   ```typescript
   interface ReactiveFramework {
     signal<T>(value: T): { get(): T; set(v: T): void };
     computed<T>(fn: () => T): { get(): T };
     effect(fn: () => void): () => void;
   }

   const signaliumFramework: ReactiveFramework = { /* wrap signalium APIs */ };
   const preactFramework: ReactiveFramework = { /* wrap preact APIs */ };
   ```
3. Generate test scenarios (reuse the fuzzer's graph generator)
4. Run each scenario through both frameworks
5. Compare final values after each mutation round

### Expected Yield
High for sync behavior, lower for async (Preact doesn't have async reactive). The gold standard for correctness — any divergence demands investigation.

---

## Approach 8: Code Review of Known-Fragile Internals

### What It Does
Deep manual code review of the specific functions identified as bug-prone through our analysis.

### Files to Review

| File | Functions | Why Fragile |
|------|-----------|-------------|
| `src/internals/get.ts` | `checkSignal`, `runSignal`, `getSignal` | Recursive dependency evaluation leaks errors; no error caching; state not cleaned up on throw |
| `src/internals/async.ts` | `_setPending`, `_clearPending`, `_setValue`, `_scheduleSubs` | Pending state management breaks at depth 3+; WeakRef-based subscriber tracking |
| `src/internals/scheduling.ts` | `flushWatchers`, `settled`, `batch` | `settled()` doesn't track async work; `batch` doesn't await flush; multiple queue interaction |
| `src/internals/watch.ts` | `watchSignal`, `unwatchSignal`, `deactivateSignal` | Relay teardown races with async resolution; `activateSignal` calls `checkSignal` inline |
| `src/internals/dirty.ts` | `dirtySignal`, `propagateDirty` | Self-dirty detection; `_subs` cleared during iteration |
| `src/internals/contexts.ts` | `setGlobalContexts`, `clearGlobalContexts`, `getCurrentScope` | Global scope mutation; split-brain between old/new scopes; priority chain confusion |

### Review Checklist
- [ ] Every `WeakRef.deref()` is followed by an `undefined` check
- [ ] No Map/Set is modified during its own iteration
- [ ] Every `try/finally` properly restores global state (CURRENT_CONSUMER, CURRENT_SCOPE)
- [ ] Error paths in `runSignal` clean up signal state (currently they don't)
- [ ] `_awaitSubs` entries are properly cleaned up when async computation completes or is abandoned
- [ ] `PENDING_DEACTIVE` entries don't race with `PENDING_ASYNC_PULLS` for the same signal

### Expected Yield
High — targeted code review of known-buggy paths almost always finds additional issues. The error handling path in `runSignal`/`checkSignal` is the most likely to have more bugs.

---

## Approach 9: Docs-vs-Implementation Testing

### What It Does
Reads signalium's documentation (signalium.dev) and writes tests that verify every behavioral claim.

### How to Implement

1. Read each page of the docs site:
   - Core: Signals, Reactive Functions, Reactive Promises, Relays, Watchers
   - Advanced: Contexts, Code Transforms, Async Context
2. For each behavioral claim, write a test:
   - "Reactive functions are memoized" → test same args return cached result
   - "Relays activate when watched and deactivate when unwatched" → test lifecycle
   - "ReactivePromise.value returns the most recent result" → test during pending states
3. Flag discrepancies between docs and actual behavior

### Expected Yield
Medium — catches documentation bugs (which are user-facing bugs) and implementation gaps where intended behavior isn't actually implemented.

---

## Approach 10: Babel Transform Correctness

### What It Does
Tests that the Babel transforms (`signaliumAsyncTransform`, `signaliumCallbackTransform`, `signaliumPromiseMethodsTransform`) correctly handle all JavaScript async patterns.

### How to Implement

Write reactive functions using progressively trickier async patterns and verify dependency tracking works:

1. Basic `async/await` (already tested)
2. `for await...of` loops reading signals
3. `Promise.race`/`Promise.all` with reactive promises inside
4. Nested async IIFEs inside reactive functions
5. Async generators (`async function*`)
6. `try/catch/finally` with signal reads in each block
7. Conditional `await` (`if (cond) await promise`)
8. Signal reads after `Promise.race` where only one branch resolves
9. Class methods decorated as reactive with async bodies
10. Reactive function that calls another reactive function that's also async

### Expected Yield
Medium — the transform tests exist but only cover basic patterns. Exotic async constructs are likely to break the transform.

---

## Priority Ranking

| Priority | Approach | Effort | Expected Bugs |
|----------|----------|--------|---------------|
| 1 | Property-based testing (fast-check) | Medium | High |
| 2 | Memory leak detection | Low | High |
| 3 | Code review of fragile internals | Low | High |
| 4 | Differential testing (Preact Signals) | Medium | High |
| 5 | Mutation testing (Stryker) | Low | Medium |
| 6 | Docs-vs-implementation | Low | Medium |
| 7 | Static analysis | Low | Medium |
| 8 | Real application simulation | High | Medium |
| 9 | Babel transform correctness | Medium | Medium |
| 10 | Concurrency model checking | High | High (but narrow) |
