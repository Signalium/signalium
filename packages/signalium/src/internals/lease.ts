import type { ReactiveSignal } from './reactive.js';
import { getRenderLeaseTtl } from './config.js';

/**
 * Render leases.
 *
 * React hooks watch their signal while rendering (so relays read during the render activate),
 * but a render is not a commitment: React can discard it (an interrupted transition, a mount that
 * suspends, StrictMode's double render) and never call the store subscription or any effect that
 * would release the watch. A render-time watch is therefore taken as a *lease*: it holds the
 * signal exactly like a normal watch, and the commit claims it by subscribing (see
 * `ReactiveSignal.addListener`). Leases nobody claims are released here once they expire.
 *
 * Expiry uses a two-generation wheel instead of a timer per lease, so taking and claiming a lease
 * is a `Set` insert/delete and the whole wheel costs a single timer, armed only while leases are
 * outstanding. Every tick releases the old generation and ages the young one, so a lease lives
 * between one and two TTLs.
 */

let young = new Set<ReactiveSignal<any, any>>();
let old = new Set<ReactiveSignal<any, any>>();
let timer: ReturnType<typeof setTimeout> | undefined;

function armTimer() {
  timer = setTimeout(sweepLeases, getRenderLeaseTtl());

  // Don't keep a Node process alive just to expire leases.
  (timer as { unref?: () => void }).unref?.();
}

function sweepLeases() {
  timer = undefined;

  const expired = old;

  for (const signal of expired) {
    signal._releaseLease();
  }

  expired.clear();

  old = young;
  young = expired;

  if (old.size > 0) {
    armTimer();
  }
}

export function addLease(signal: ReactiveSignal<any, any>) {
  young.add(signal);

  if (timer === undefined) {
    armTimer();
  }
}

export function removeLease(signal: ReactiveSignal<any, any>) {
  if (!young.delete(signal)) {
    old.delete(signal);
  }
}

/**
 * Pins a render lease while the render that took it is suspended on `thenable`, then gives it a
 * fresh TTL once the thenable settles. A render that suspends keeps waiting on data its own watch
 * keeps alive (a relay that only resolves while active would otherwise never resolve), and React
 * retries it only after the thenable settles, which can be later than the TTL. A thenable that
 * never settles pins the lease for good, like the watch it replaces.
 */
export function holdLeaseUntilSettled(signal: ReactiveSignal<any, any>, thenable: PromiseLike<unknown>) {
  if (!signal._isLeased) {
    return;
  }

  removeLease(signal);

  const renew = () => {
    if (signal._isLeased) {
      removeLease(signal);
      addLease(signal);
    }
  };

  thenable.then(renew, renew);
}

/**
 * Releases every outstanding lease immediately. Intended for tests and for app-level teardown
 * (e.g. when the app is backgrounded and nothing rendered so far is going to commit).
 */
export function releaseRenderLeases() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }

  const expired = old;
  const pending = young;

  old = new Set();
  young = new Set();

  for (const signal of expired) {
    signal._releaseLease();
  }

  for (const signal of pending) {
    signal._releaseLease();
  }
}

/** Number of render leases that have not been claimed or released yet (for tests/debugging). */
export function getRenderLeaseCount() {
  return young.size + old.size;
}
