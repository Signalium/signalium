/**
 * Server-safe entry for `signalium/react` (activated by the `react-server` export condition).
 *
 * Re-exports the server variant of `component()` which returns real async function components
 * instead of hooks-based Suspense wrappers. No React hook imports — safe for RSC bundles.
 */
export { default as component } from './component-server.js';
