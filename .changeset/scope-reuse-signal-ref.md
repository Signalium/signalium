---
'signalium': patch
---

Store each scope entry under the signal's own `WeakRef` instead of allocating a second one per signal.
