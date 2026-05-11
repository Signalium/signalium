---
'signalium': patch
---

Fix `registerCustomSnapshot` to apply to subclasses of the registered class. Previously, a handler registered on a base class was only invoked for direct instances of that class — subclass instances bypassed it because the resolver did an exact-prototype lookup. Custom snapshot registrations now use a non-enumerable symbol on the class prototype, so JS prototype lookup naturally walks the chain and subclasses inherit their ancestor's handler. Subclasses can still override by registering their own handler. The public API is unchanged.
