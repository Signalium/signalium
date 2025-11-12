---
'signalium': patch
'@signalium/query': patch
---

Signalium:
- Add support for Sets, Maps, and Dates in the `hashValue` function
  - Note: This may cause some _minor_ differences in reactive functions that receive these types as parameters, they should essentially run less often in those cases. The impact of this should be minimal, so we're not considering it a breaking change.

Query:
- Add shape checking to make sure that if the shape of a query is changed, the query key will change as well, preventing stale data with a different shape from being returned from the query store
- Fix an issue where shrinking the `maxCount` of a query would cause an error when trying to activate the query
