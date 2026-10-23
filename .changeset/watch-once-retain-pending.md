---
'signalium': patch
---

Fix `watchOnce` letting a pending async graph be garbage collected before it settles. The watcher is now kept alive until its promise fulfills or rejects.
