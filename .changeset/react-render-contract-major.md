---
'signalium': major
---

Release the React render-path changes as a major version. They change behavior that existing apps can observe:

- `component()` props are treated as immutable, the same contract as `React.memo`. When every prop is identical (by `Object.is`) to the previous render, the previous props hash is reused, and React element props are hashed by identity. A plain object, array, `Map`, `Set` or `Date` mutated in place and passed again no longer re-renders a `component()` child; pass a new value instead. Freshly created element children (`children={<X />}`) re-render the child on every parent render.
- `component()` mounts in one render instead of two.
- Watches taken during render are leases. A render React discards (an interrupted transition, a mount that suspends, a StrictMode double render) releases its relays after `renderLeaseTtl` (default 10 s) instead of keeping them active for the rest of the session. `useReactive` and `useReactiveShallow` readers suspended by React 19's `use()` for longer than the TTL lose their lease, so their relays may deactivate and restart when React retries the render.
