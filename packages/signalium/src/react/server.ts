import * as React from 'react';
import { setRequestScopeGetter, SignalScope } from '../internals/contexts.js';

type CacheFn = <T extends (...args: never[]) => unknown>(fn: T) => T;

function getReactCache(): CacheFn {
  const cache = (React as typeof React & { cache?: CacheFn }).cache;
  if (typeof cache !== 'function') {
    throw new Error(
      'setupRscRequestScope() requires React.cache (React 19+). Upgrade react and react-dom in this app.',
    );
  }
  return cache;
}

let getCachedRequestScope: (() => SignalScope) | undefined;

/**
 * Register a per-request {@link SignalScope} for server `reactive()` / `task()` / `relay()` using
 * React's `cache` (same lifetime as other per-request memoization in RSC / Flight).
 *
 * Call **once** per server bundle before any server-side reactive work (e.g. top of root layout or
 * `instrumentation.ts`). Safe to call multiple times; the last registration wins.
 *
 * Requires **React 19+** (`React.cache`). Does not run in the browser: import this module only from
 * server code paths.
 */
export function setupRscRequestScope(): void {
  if (getCachedRequestScope === undefined) {
    getCachedRequestScope = getReactCache()(() => new SignalScope([]));
  }
  setRequestScopeGetter(() => getCachedRequestScope!());
}
