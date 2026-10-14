---
'signalium': patch
---

Fix a rejected async reactive turning Ready with no value. Suppose a reactive rejects, one of its awaited dependencies then goes pending, and that dependency resolves to an equal value. The reactive used to leave pending by resolving with its stored value, which cleared the error, set `isReady`, and left `value` `undefined`. It now returns to its rejected state with the error preserved.
