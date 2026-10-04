import type { ReactiveSignal } from './reactive.js';
import { getRenderLeaseTtl, MAX_TIMEOUT } from './config.js';

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
 * between one and two TTLs, counted from the last render that read the signal.
 *
 * A render that suspends is waiting on something, and that something may only arrive while the
 * render's own relays are active (a socket whose first payload resolves the promise). Its lease is
 * *pinned* instead: taken off the wheel until the suspension ends. See `holdLeaseUntilSettled` and
 * `holdSuspendedLease`.
 */

let young = new Set<ReactiveSignal<any, any>>();
let old = new Set<ReactiveSignal<any, any>>();
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Pinned leases, by the token of the suspension that pinned them. A later pin, a re-render, a
 * claim or a release replaces or removes the entry, so a stale suspension settling (or timing
 * out) can't unpin a lease that a newer suspension holds.
 */
const pinned = new Map<ReactiveSignal<any, any>, object>();

/**
 * How long a lease stays pinned for a suspension whose thenable signalium cannot see (React's
 * `use()`), as a multiple of the lease TTL. Such a pin normally ends when React retries or commits
 * the render; this bound only applies when React abandons the suspended render (its Suspense
 * boundary unmounts first), which nothing reports.
 */
export const SUSPENDED_LEASE_HOLD_TTLS = 30;

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

/**
 * Starts a lease's TTL, or restarts it: a render that reads a still-leased signal again (a retry,
 * a restarted transition) extends the lease, and ends a pin (the suspension it was held for is
 * over; a render that suspends again pins it again).
 */
export function addLease(signal: ReactiveSignal<any, any>) {
  if (!pinned.delete(signal)) {
    old.delete(signal);
  }

  young.add(signal);

  if (timer === undefined) {
    armTimer();
  }
}

export function removeLease(signal: ReactiveSignal<any, any>) {
  if (!young.delete(signal) && !old.delete(signal)) {
    pinned.delete(signal);
  }
}

function pinLease(signal: ReactiveSignal<any, any>): object | undefined {
  if (!signal._isLeased) {
    return undefined;
  }

  young.delete(signal);
  old.delete(signal);

  const token = {};
  pinned.set(signal, token);

  return token;
}

/** Ends a pin if `token` still owns it, giving the lease a fresh TTL. */
function unpinLease(signal: ReactiveSignal<any, any>, token: object) {
  if (pinned.get(signal) === token && signal._isLeased) {
    addLease(signal);
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
  const token = pinLease(signal);

  if (token === undefined) {
    return;
  }

  const renew = () => unpinLease(signal, token);

  thenable.then(renew, renew);
}

/**
 * Pins a render lease while the render that took it is suspended on a thenable signalium cannot
 * see: React 19's `use()` throws an opaque `SuspenseException` and keeps the thenable to itself.
 * React re-renders the suspended content once the thenable settles; that render re-reads the
 * signal (refreshing the lease) or, for a mount, starts a new attempt that ends this pin through
 * {@link releaseAbandonedAttempt}, so the pin normally ends there or at the commit. If React
 * abandons the render instead, the pin ends after {@link SUSPENDED_LEASE_HOLD_TTLS} TTLs and the
 * lease then expires normally.
 */
export function holdSuspendedLease(signal: ReactiveSignal<any, any>) {
  const token = pinLease(signal);

  if (token === undefined) {
    return;
  }

  const hold = setTimeout(
    () => unpinLease(signal, token),
    Math.min(getRenderLeaseTtl() * SUSPENDED_LEASE_HOLD_TTLS, MAX_TIMEOUT),
  );

  (hold as { unref?: () => void }).unref?.();
}

/**
 * Gives a lease pinned by an earlier, suspended attempt at mounting the same element a fresh TTL.
 * React keeps no render state for a mount that suspends, so its retry is a new attempt with new
 * signals; once the retry has read (and leased) what it needs, the old attempt's lease only has
 * to bridge the gap until the retry commits.
 */
export function releaseAbandonedAttempt(signal: ReactiveSignal<any, any>) {
  const token = pinned.get(signal);

  if (token !== undefined) {
    unpinLease(signal, token);
  }
}

/**
 * Releases every outstanding lease immediately, pinned ones included. Intended for tests and for
 * app-level teardown (e.g. when the app is backgrounded and nothing rendered so far is going to
 * commit).
 */
export function releaseRenderLeases() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }

  const leases = [...old, ...young, ...pinned.keys()];

  old = new Set();
  young = new Set();
  pinned.clear();

  for (const signal of leases) {
    signal._releaseLease();
  }
}

/**
 * Number of render leases that have not been claimed or released yet, including leases pinned
 * for a suspended render. For tests and debugging.
 */
export function getRenderLeaseCount() {
  return young.size + old.size + pinned.size;
}
