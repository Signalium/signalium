---
"@signalium/query": patch
---

Add no-op implementations of MemoryEvictionManager, RefetchManager, and NetworkManager for SSR environments. These can be injected into QueryClient constructor to avoid creating timers and event listeners in server-side rendering contexts.
