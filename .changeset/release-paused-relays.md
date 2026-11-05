---
'signalium': minor
---

Give relays a final cleanup when a paused reader is released without resuming. A pause deactivates relays with `isPausing: true` so consumers keep their cached state. If the paused reader then lost its last listener (for example, a covered screen unmounting), the relays never received the non-pausing deactivate, and consumers such as Fetchium never scheduled their cached queries for collection.

A relay gets the cleanup only once every paused reader that depends on it is released. That includes readers that subscribed or rendered while already paused, and readers that started or stopped reading it while paused, directly or through other signals. If its last active reader leaves while a paused reader remains, it is now deactivated with `isPausing: true` instead of being cleaned up. `RelayHooks.deactivate` can now be called twice for one activation, first with `{ isPausing: true }` and then with `{ isPausing: false }`, with no `activate` between. Hooks must accept the second call.

A reader that stops reading a relay while paused, or that recomputes after its last listener left, no longer releases another reader's watch on that relay.
