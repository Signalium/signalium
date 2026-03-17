---
"signalium": patch
---

Add `skipInitial` option to `watcher.addListener()` to skip the notification fired on initial activation

Fix: Reset `listeners.updatedAt` when all listeners are removed, so re-subscribing correctly fires the initial notification. Previously, stale `updatedAt` state could cause missed notifications after unsubscribing and re-subscribing.
