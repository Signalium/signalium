---
"signalium": patch
---

React ContextProvider: store SignalScope in a ref so the same scope instance is reused across re-renders instead of being recreated each time, avoiding orphaned signals and unnecessary memory usage.
