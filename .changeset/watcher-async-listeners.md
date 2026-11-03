---
'signalium': patch
---

Fix `watcher(async () => ...)` never notifying its listeners after the first result. Listeners now run when the watcher's async result settles to a new value or error.
