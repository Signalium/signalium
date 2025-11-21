---
'@signalium/query': patch
---

Add useQuery for reading query results. Calling `useReactive` on a query result
will cause the result itself to entangle, but not the value of the result (e.g.
the entities inside the result). This can lead to cases where the result is not
re-rendered when the entities inside the result change. By cloning the result,
we effectively reify it and force it to flatten, entangling all of the nested
entities with that read from React.
