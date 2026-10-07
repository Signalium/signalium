import type { ReactiveSignal } from './reactive.js';
import { getRenderLeaseTtl, MAX_TIMEOUT } from './config.js';

/**
 * Render leases.
 *
 * Hooks watch their signal during render so the relays it reads activate. React can discard a
 * render (an interrupted transition, a suspended mount, StrictMode) without ever subscribing, so
 * that watch is a lease: the commit's subscription claims it (`ReactiveSignal.addListener`), and
 * unclaimed leases are released when they expire.
 *
 * Expiry is a two-generation wheel on one timer, so a lease lives one to two TTLs after the last
 * render that read the signal.
 *
 * A suspended render may be waiting on data only its own relays produce, so its lease is pinned
 * until the suspension ends (`holdLeaseUntilSettled`, `holdSuspendedLease`).
 */

let young = new Set<ReactiveSignal<any, any>>();
let old = new Set<ReactiveSignal<any, any>>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Pinned leases, by suspension token, so a stale suspension can't unpin a newer one's lease. */
const pinned = new Map<ReactiveSignal<any, any>, object>();

/**
 * How long, in TTLs, a `use()` suspension pins a lease. The retry or commit normally ends the pin;
 * this bounds it when React abandons the render, which nothing reports.
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

/** Starts or restarts a lease's TTL. A new render also ends a pin: the suspension is over. */
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
 * Pins a render lease until `thenable` settles. React retries a suspended render only then, which
 * can be later than the TTL.
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
 * Pins a render lease for a `use()` suspension, whose thenable React keeps to itself. The retry or
 * commit normally ends the pin; otherwise it ends after {@link SUSPENDED_LEASE_HOLD_TTLS} TTLs.
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
 * Unpins a lease held by an earlier, suspended attempt at mounting the same element. The retry
 * starts over with new signals, so once it has leased its own, the old lease only needs to last
 * until the commit.
 */
export function releaseAbandonedAttempt(signal: ReactiveSignal<any, any>) {
  const token = pinned.get(signal);

  if (token !== undefined) {
    unpinLease(signal, token);
  }
}

/** Releases every outstanding lease, pinned ones included. For tests and app teardown. */
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

/** Outstanding render leases, pinned ones included. For tests and debugging. */
export function getRenderLeaseCount() {
  return young.size + old.size + pinned.size;
}
