---
'signalium': patch
---

Fixed an issue where reactive promises were overly eager and scheduling even
when they were not watched.
