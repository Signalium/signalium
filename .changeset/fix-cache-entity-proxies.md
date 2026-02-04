---
"@signalium/query": patch
---

Fix entity proxies not being created for preloaded entities from cache, and `__entityRef` not being resolved in proxy get handler. This fixes validation errors when accessing nested entities loaded from persistent cache.
