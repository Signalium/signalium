---
'signalium': patch
---

Fix `useReactive` snapshots of `ReactiveTask` to carry over the `run` method. Previously, when a task was read through `useReactive`, the deep-snapshot returned a plain object with `value`/`error`/`isPending`/etc. but no `run`, so consumers couldn't invoke `result.run(...)` against the underlying task. The snapshot now includes `run`, and its identity is included in the structural-equality short-circuit so reference stability across pending → resolved transitions is preserved.
