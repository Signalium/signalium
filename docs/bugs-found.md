# Bugs Found in Signalium

Discovered through systematic cross-framework test mining, ecosystem bug pattern reproduction, and async concurrency testing. All bugs are documented as `test.fails` in the test suite.

**Total: 5 unique bugs across 8 failing test cases.**

---

## Bug 1: Errors Are Never Cached in Computed Signals

**Severity:** Medium  
**Category:** Error handling  
**Test file:** `packages/signalium/src/__tests__/cross-framework-error-handling.test.ts`  
**Test name:** `thrown error is cached and rethrown without recomputing`

### Description

When a reactive function throws an error, every subsequent read recomputes the function from scratch instead of caching and rethrowing the error. Every other signals framework in the ecosystem (Preact Signals, Vue, SolidJS, TC39 polyfill) caches thrown errors.

### Reproduction

```typescript
const s = signal('first');
let computeCount = 0;

const c = reactive(() => {
  computeCount++;
  throw new Error(s.value);
});

expect(() => c()).toThrow('first');
expect(computeCount).toBe(1);

// Read again — should rethrow cached error without recomputing
expect(() => c()).toThrow('first');
expect(computeCount).toBe(1); // FAILS: computeCount is 2
```

### Root Cause

In `src/internals/get.ts`, when `runSignal()` throws, the error propagates out of `checkSignal()` before it reaches the cleanup code at line 129:

```typescript
// checkSignal():
if (newState === ReactiveFnState.Dirty) {
  runSignal(signal);  // throws — everything below is skipped
}

signal._state = ReactiveFnState.Clean;  // never reached
signal.dirtyHead = undefined;           // never reached
```

Because `signal._state` remains `Dirty`, every subsequent `checkSignal()` call runs `runSignal()` again.

### Impact

Performance degradation. A computed that conditionally throws (e.g., validation) is recomputed on every read by every consumer, even though the error hasn't changed.

---

## Bug 2: Errors from Dependencies Leak Through `checkSignal`, Bypassing Consumer's try/catch

**Severity:** High  
**Category:** Error handling  
**Test file:** `packages/signalium/src/__tests__/cross-framework-error-handling.test.ts`  
**Test name:** `computed recovers after conditional error clears`

### Description

When a reactive function wraps a potentially-throwing dependency in try/catch, the try/catch never fires. The error from the dependency leaks through `checkSignal()` before the consumer's compute function ever executes.

### Reproduction

```typescript
const shouldThrow = signal(false);

const maybeThrow = reactive(() => {
  if (shouldThrow.value) throw new Error('boom');
  return 42;
});

const downstream = reactive(() => {
  try {
    return maybeThrow();  // try/catch should handle errors
  } catch {
    return -1;  // fallback
  }
});

expect(downstream()).toBe(42);

shouldThrow.value = true;
expect(downstream()).toBe(-1);  // FAILS: error leaks, -1 never returned
```

### Root Cause

`checkSignal(downstream)` recursively calls `checkSignal(maybeThrow)` at line 100 of `get.ts` to evaluate the dependency. When `maybeThrow` throws, the error propagates out of `checkSignal(downstream)` **before** `downstream`'s compute function (which contains the try/catch) ever runs.

```
checkSignal(downstream)
  └─ checkSignal(maybeThrow)    ← line 100: recursive dep check
       └─ runSignal(maybeThrow) ← dep is Dirty, runs compute
            └─ THROWS
       ← error propagates out
  ← error propagates out        ← downstream's compute NEVER RUNS
```

In other frameworks, dependencies are evaluated during the consumer's computation (when `dep.value` is read), so the consumer's try/catch naturally wraps the throw.

### Impact

Reactive functions cannot build error-boundary-like patterns. A common pattern — wrapping a potentially-failing data source in try/catch for a fallback — silently breaks when the dependency transitions from non-throwing to throwing while watched. The error also leaks as an unhandled rejection through the watcher's pull mechanism.

---

## Bug 3: `settled()` Does Not Wait for Async Reactive Computations

**Severity:** High  
**Category:** Async scheduling  
**Test file:** `packages/signalium/src/__tests__/async-concurrency-edge-cases.test.ts`  
**Test names:** `settled() resolves after deeply nested async chain completes`, `settled() handles multiple concurrent async chains`

### Description

`settled()` returns as soon as the scheduler's internal pull queue is empty, but async reactive functions that perform real async work (setTimeout, fetch, etc.) haven't finished yet. There is no reliable programmatic way to wait for all async reactives to resolve.

### Reproduction

```typescript
const src = signal(0);

const asyncData = reactive(async () => {
  const v = src.value;
  await sleep(5);  // simulates real async work (fetch, etc.)
  return v;
});

const w = watcher(() => asyncData());
w.addListener(() => {});

src.value = 42;
await settled();  // returns immediately!

const result = asyncData();
expect(result.isResolved).toBe(true);  // FAILS: still isPending
```

### Root Cause

In `src/internals/scheduling.ts`, `settled()` awaits `currentFlush.promise`, which resolves when `flushWatchers()` finishes. `flushWatchers()` loops while `PENDING_PULLS` or `PENDING_ASYNC_PULLS` are non-empty, but async reactive functions that use real async operations (not just microtasks) schedule their resolution independently. The pull queue drains immediately after starting the async computation, so `flushWatchers` resolves before the actual work completes.

```typescript
// settled() — scheduling.ts:148
export const settled = async () => {
  while (currentFlush) {
    await currentFlush.promise;  // resolves when pull queue is empty
  }
};

// But the async reactive's setTimeout/fetch is still running...
```

### Impact

Any code relying on `await settled()` to ensure data is ready will see stale/pending values. Tests in the repo work around this with `await sleep(N)`, which is fragile and non-deterministic.

---

## Bug 4: Deep Async Chains (3+ Levels) Permanently Stuck Pending

**Severity:** Critical  
**Category:** Async state management  
**Test files:** `packages/signalium/src/__tests__/clearPending-awaitSubs.test.ts` (pre-existing), `packages/signalium/src/__tests__/async-concurrency-edge-cases.test.ts`  
**Test names:** `3-level async chain with concurrent notifier + signal change`, `4-level chain with notifier + signal change`, `5-level chain with notifier + signal change`

### Description

When a `notifier()` and a `signal` change concurrently in an async reactive chain **3 or more levels deep**, the consumer gets permanently stuck with `isPending === true` and never resolves. The 2-level case works correctly.

### Reproduction

```typescript
const n = notifier();
const entity = signal(100);
const storage = signal('data');

// 3-level async chain
const level0 = reactive(async () => {
  n.consume();
  await sleep(10);
  return storage.value;
});
const level1 = reactive(async () => await level0());
const level2 = reactive(async () => await level1());

// Consumer reads end of chain + independent signal
const consumer = reactive(async () => {
  const chainValue = await level2();
  return `${chainValue}-${entity.value}`;
});

const w = watcher(() => consumer());
w.addListener(() => {});

await sleep(50);
expect(consumer().value).toBe('data-100');  // OK

// Concurrent notifier + signal change
n.notify();
entity.value = 200;

await sleep(200);

expect(consumer().isPending).toBe(false);  // FAILS: permanently true
expect(consumer().value).toBe('data-200'); // never reached
```

### Root Cause

When the notifier fires, the entire async chain is marked dirty and starts re-resolving. The chain eventually resolves to the same value (the notifier doesn't change `storage`). Meanwhile, `entity.value = 200` separately dirtied the consumer. The `_clearPending` mechanism in `checkSignal` (which should clear the pending state when a dependency resolves to the same value) fails to propagate correctly through the `_awaitSubs` map at chain depths of 3 or more.

The bug has a clear threshold: depth 2 works, depth 3+ fails. This has been confirmed at depths 3, 4, and 5 through manual tests.

### Impact

This is a real-world scenario. A WebSocket notification (modeled as a `notifier`) and a user action (modeled as a `signal` change) happening simultaneously will permanently break any reactive chain with 3+ levels of async nesting. The UI would show a loading spinner forever. This is the most severe bug found.

---

## Bug 5: Watcher Removal Mid-Flight Loses Async Result

**Severity:** High  
**Category:** Watcher lifecycle  
**Test file:** `packages/signalium/src/__tests__/ecosystem-bug-patterns.test.ts`  
**Test name:** `removing last watcher while async reactive is mid-computation`

### Description

After removing the last watcher while an async reactive is mid-computation, reading the reactive function returns `value === undefined` instead of the last resolved value or the in-flight result.

### Reproduction

```typescript
const src = signal(1);

const asyncComputed = reactive(async () => {
  const v = src.value;
  await sleep(20);
  return v * 2;
});

const w = watcher(() => asyncComputed());
const unsub = w.addListener(() => {});

await sleep(30);
expect(asyncComputed().value).toBe(2);  // OK: initial value

src.value = 2;       // trigger recomputation
await sleep(5);      // async is mid-flight (at the await sleep(20))
unsub();             // remove last watcher

await sleep(30);     // async finishes

const result = asyncComputed();
expect(result.value).toBe(4);    // FAILS: value is undefined
// Expected either 4 (new result) or 2 (last known value)
```

### Root Cause

When the last watcher is removed, the signal is scheduled for deactivation via `scheduleDeactivate`. The deactivation process resets the signal's state, discarding the in-flight async computation's result. When the async computation eventually resolves, there's no longer a signal to receive the value. Re-reading the reactive function creates a fresh computation that starts from scratch, returning a pending promise with `undefined` value.

### Impact

In a React application, if a component unmounts (removing its watcher) while data is loading and then re-mounts, the reactive function returns `undefined` instead of the last known value. This causes a flash of empty content followed by a re-fetch, even though the data was already available or nearly ready.

---

## Summary Table

| # | Bug | Severity | Root Cause Location | Failing Tests |
|---|-----|----------|--------------------|-|
| 1 | Errors not cached | Medium | `get.ts:119-129` — state not cleaned on throw | 1 |
| 2 | Errors bypass try/catch | High | `get.ts:100` — recursive checkSignal before compute | 1 |
| 3 | `settled()` premature return | High | `scheduling.ts:148-151` — only tracks pull queue | 2 |
| 4 | Deep async pending forever | Critical | `get.ts:64-112` + `async.ts` — clearPending fails at depth 3+ | 4 |
| 5 | Watcher removal data loss | High | `watch.ts` — deactivation discards in-flight async | 1 |

## Test Files

All bugs are documented as `test.fails` in these files:

- `packages/signalium/src/__tests__/cross-framework-error-handling.test.ts` — Bugs 1, 2
- `packages/signalium/src/__tests__/async-concurrency-edge-cases.test.ts` — Bugs 3, 4
- `packages/signalium/src/__tests__/ecosystem-bug-patterns.test.ts` — Bug 5
- `packages/signalium/src/__tests__/clearPending-awaitSubs.test.ts` — Bug 4 (pre-existing test)

## How to Run

```bash
# Run all bug-documenting tests
cd packages/signalium
npx vitest run --project unit src/__tests__/cross-framework-error-handling.test.ts \
  src/__tests__/async-concurrency-edge-cases.test.ts \
  src/__tests__/ecosystem-bug-patterns.test.ts
```
