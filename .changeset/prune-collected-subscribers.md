---
'signalium': patch
---

Delete collected consumers from subscriber maps as they grow. A dependency that rarely changes cleared its map only when it notified, so it kept one entry per consumer it ever had.
