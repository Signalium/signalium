---
'signalium': minor
---

`component()` no longer walks React element trees when hashing props. A React element is a plain object, so the structural props hash recursed through `props` and every descendant element — for a component taking `children`, that walk dominated each render, and reached into whatever the child elements' own props pointed at. Element-valued props are now hashed by identity: nothing reads through an element, and `hashValue` already hashes by identity any object whose prototype it doesn't recognise — elements only escaped that because they happen to be plain objects.

Every other prop keeps its structural hash, so a new-but-equivalent object or array still reuses the previous render, and a value whose class has a `registerCustomHash` function (an `Array` subclass included) is still hashed by it. Applies to async `component()` too, which hashed props the same way.

**Behaviour change:** a freshly-created children tree that is structurally identical to the previous one no longer reuses the memoized render, so such a component re-renders where it used to be skipped. Nothing can go stale as a result — React skips a subtree whose element is referentially identical, so a re-render was never what made an update visible. If a component relied on being skipped for a fresh-but-equal `children` (or other element) prop, hoist the element or memoize it so the same element is passed again.
