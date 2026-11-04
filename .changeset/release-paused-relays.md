---
'signalium': patch
---

Give relays a final cleanup when a paused reader is released without resuming. A pause deactivates relays with `isPausing: true` so consumers keep their cached state. If the paused reader then lost its last listener (for example, a covered screen unmounting), the relays never received the non-pausing deactivate, and consumers such as Fetchium never scheduled their cached queries for collection.
