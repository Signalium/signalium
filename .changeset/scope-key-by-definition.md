---
'signalium': patch
---

Key scope entries by a hash stored on the reactive definition instead of registering every compute function in a `WeakMap`. Each `useReactive` thunk identity cost one extra `WeakMap` entry.
