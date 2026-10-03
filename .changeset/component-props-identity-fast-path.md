---
'signalium': patch
---

`component()` no longer hashes its props when every prop is identical (by `Object.is`) to the previous render's — the common case of a parent re-rendering without changing anything — and reuses the previous hash instead. A shallow identity check costs a fraction of the structural hash (6–30x less for typical props in a micro-benchmark).

Props are now treated as immutable, the same contract as `React.memo` and the React Compiler: a plain object, array, `Map`, `Set` or `Date` prop mutated in place and passed again under the same identity no longer re-renders the component (the structural hash used to notice such a mutation). Pass a new object, or read changing data from a signal inside the component. Applies to async `component()` too.
