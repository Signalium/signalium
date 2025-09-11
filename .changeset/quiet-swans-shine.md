---
'signalium': patch
---

Add setScopeOwner API. This was an oversight from the v2 release, it's necessary
for reactiveMethod to work correctly on nested context objects. The API is a bit
clunky, it's likely to change in the future as we refine the context API and add
some better abstractions for dependency-injection like features.
