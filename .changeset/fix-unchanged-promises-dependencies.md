---
"signalium": patch
---

Fix unchanged promises losing dependencies

This fix ensures that promises that haven't changed maintain their dependency edges in the `_awaitSubs` map, preventing dangling references and ensuring correct reactive computation order.

**Changes:**
- Updated `checkSignal()` to preserve dependency edges for unchanged promises by adding them to the promise's `_awaitSubs` map
- Modified `disconnectSignal()` to accept `computedCount` parameter for proper dependency tracking
- Added documentation explaining promise edge tracking in `_setPending()`
- Removed obsolete `PROMISE_WAS_RESOLVED` flag mechanism from scheduling system
