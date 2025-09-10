---
'signalium': patch
---

Remove unnecessary type overloads for reactive().

These type overloads were preventing tasks return from Reactives from being
properly typed.
