---
'signalium': patch
---

Key scope entries by a hash stored on the reactive definition instead of registering every compute function in a `WeakMap`. Each `useReactive` thunk identity cost one extra `WeakMap` entry.

Each `reactiveMethod` call now caches its own signals. Two `reactiveMethod` calls given the same function no longer share a cached signal.
