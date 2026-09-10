---
'signalium': minor
---

Export `snapshotArray`, `snapshotPlainObject` and the `SnapshotFn` type from `signalium/utils`. A custom snapshot handler whose leaves need different treatment — unwrapping a container type, say — can't delegate to `snapshot`, which always recurses through itself, so it had to reimplement the array and plain-object walks to recurse through its own function instead. Both walkers already took the recursion function as a parameter; they just weren't reachable. Nothing about `snapshot` changes.
