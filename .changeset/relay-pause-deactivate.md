---
"signalium": patch
---

`RelayHooks.deactivate` now receives a `DeactivateOptions` object with an `isPausing` flag, distinguishing a temporary pause (e.g. `PauseSignalsProvider`) from a genuine cleanup. Relays can use it to skip destructive work like garbage collection while pausing. `DeactivateOptions` is exported.
