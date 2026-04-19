---
'signalium': major
---

Switch to native `WeakRef` for scope-cached signals, remove suspension from the core graph, and introduce `PauseSignalsProvider`.

### Native WeakRef GC

`SignalScope` now stores signals as `WeakRef` entries instead of strong references with manual GC sweeps. Signals stay alive as long as something holds a strong reference (the `deps` chain, a React component closure, a local variable, etc.). When nothing references a signal, the JS garbage collector reclaims it naturally.

Removed:
- The `WeakRef` polyfill (`weakref.ts`) — environments without native `WeakRef` are no longer supported.
- The manual GC sweep system (`markForGc`, `removeFromGc`, `sweepGc`, `gcCandidates`, `scheduleGcSweep`, `scheduleIdleCallback`).
- `reset()` on `ReactiveSignal` — signals are no longer eagerly torn down on unwatch. Their value and dep graph are preserved for reuse if re-watched before GC collects them.

### Suspension removed from core

The core signal graph has zero suspension concepts. Removed:
- `suspendCount` field and `_isSuspended` getter on `ReactiveSignal`
- `setSuspended()` method and `isSuspendedListener` flag
- `watchSuspendedSignal`, `unwatchSuspendedSignal`, `suspendSignal`, `resumeSignal`
- The `parentIsSuspended` parameter on `watchSignal` / `unwatchSignal`
- The `isSuspending` branch in `deactivateSignal`

### `PauseSignalsProvider` (replaces `SuspendSignalsProvider`)

`SuspendSignalsProvider` is replaced by `PauseSignalsProvider` to avoid confusion with React Suspense.

`PauseSignalsProvider` uses a stable `PauseSignalsManager` context (not a changing boolean), so toggling the `value` prop does not re-render descendants. React hooks register their signals during render; the manager calls `watchSignal` / `unwatchSignal` directly to pause and resume the signal graph. Signals mounted inside an already-paused provider skip activation entirely.

### Breaking changes

- `SuspendSignalsProvider` → `PauseSignalsProvider`
- `useSignalsSuspended()` is removed from the public API.
- `setSuspended()` is removed from the `Watcher` interface.
- Environments without native `WeakRef` are no longer supported.
