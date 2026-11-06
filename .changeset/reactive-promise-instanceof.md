---
'signalium': patch
---

Recognize `ReactivePromise` instances with `instanceof` instead of adding each one to a `WeakSet`. `setReactivePromise` still marks other values.
