---
'signalium': minor
---

New `deliverAsTransitionsFor(ms)` in `signalium/react`. For the next `ms` milliseconds, `'state'` deliveries render inside `startTransition` instead of at React's default priority, so React time-slices a burst of updates, such as a screen resuming after a tab switch, instead of blocking frames. A call never shortens an open window. `'sync'` readers are unaffected.
