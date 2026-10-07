import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sleep } from './utils/async.js';
import { reactive, relay, reactiveSignal } from '../index.js';
// The package path, so the Babel preset transforms async callbacks passed to it.
import { retain } from 'signalium';
import { setConfig } from '../config.js';
import { DEFAULT_RENDER_LEASE_TTL, getRenderLeaseTtl, MAX_TIMEOUT } from '../internals/config.js';
import {
  getRenderLeaseCount,
  holdLeaseUntilSettled,
  holdSuspendedLease,
  releaseAbandonedAttempt,
  releaseRenderLeases,
  SUSPENDED_LEASE_HOLD_TTLS,
} from '../internals/lease.js';
import type { ReactiveSignal } from '../internals/reactive.js';

const TTL = 100;

function createRelayHarness() {
  const counts = { active: 0, activations: 0 };
  const source = relay<number>(state => {
    counts.active++;
    counts.activations++;
    state.value = 1;
    return () => {
      counts.active--;
    };
  });
  const derived = reactiveSignal(() => source.value) as unknown as ReactiveSignal<number | undefined, []>;
  return { counts, derived };
}

/** Lets the scheduler flush (pulls and deactivations). */
const flush = () => sleep(5);

/** Mimics a render: watch lazily, then read the value. */
function renderRead(signal: ReactiveSignal<any, any>, watch = true) {
  const subscribe = signal.addListenerLazy(watch);
  void signal.value;
  return subscribe;
}

describe('render leases', () => {
  beforeEach(() => {
    setConfig({ renderLeaseTtl: TTL });
  });

  afterEach(() => {
    releaseRenderLeases();
    setConfig({ renderLeaseTtl: DEFAULT_RENDER_LEASE_TTL });
  });

  test('an unclaimed render watch is released after the TTL', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    await flush();

    expect(counts.active).toBe(1);
    expect(getRenderLeaseCount()).toBe(1);

    // Still held just before the minimum lifetime.
    await sleep(TTL - 40);
    await flush();
    expect(counts.active).toBe(1);

    // Released by twice the TTL at the latest.
    await sleep(TTL + 50);
    await flush();
    expect(counts.active).toBe(0);
    expect(getRenderLeaseCount()).toBe(0);
    expect(derived.watchCount).toBe(0);
    expect(derived._isListener).toBe(false);
  });

  test('an unclaimed lease over paused subscribers returns the signal to paused', async () => {
    const { counts, derived } = createRelayHarness();
    derived._addPausedReaders(1);
    const unsubscribe = derived.addListener(() => {});
    expect(counts.active).toBe(0);

    // An unpaused render that is discarded.
    renderRead(derived);
    await flush();
    expect(counts.active).toBe(1);

    await sleep(TTL * 2 + 50);
    await flush();
    expect(counts.active).toBe(0);
    expect(derived._isListener).toBe(true);

    unsubscribe();
  });

  test('a paused reader subscribing does not drop an unpaused render lease', async () => {
    const { counts, derived } = createRelayHarness();
    derived._addPausedReaders(1);
    const unsubscribeFirst = derived.addListener(() => {});

    // An unpaused render that suspends, so it doesn't subscribe yet.
    const subscribe = renderRead(derived);
    await flush();
    expect(counts.active).toBe(1);

    derived._addPausedReaders(1);
    const unsubscribeSecond = derived.addListener(() => {});
    await flush();
    expect(counts.active).toBe(1);

    // Both paused readers unmount.
    unsubscribeFirst();
    unsubscribeSecond();
    derived._addPausedReaders(-2);
    await flush();
    expect(counts.active).toBe(1);

    // The render commits and claims its lease.
    const unsubscribeRender = subscribe(() => {});
    expect(getRenderLeaseCount()).toBe(0);

    unsubscribeRender();
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a claimed lease keeps the watch past the TTL without restarting relays', async () => {
    const { counts, derived } = createRelayHarness();

    const subscribe = renderRead(derived);
    await flush();

    const unsubscribe = subscribe(() => {});
    expect(getRenderLeaseCount()).toBe(0);
    expect(derived.watchCount).toBe(1);

    await sleep(TTL * 3);
    await flush();

    expect(counts.active).toBe(1);
    expect(counts.activations).toBe(1);

    unsubscribe();
    await flush();
    expect(counts.active).toBe(0);
    expect(derived.watchCount).toBe(0);
  });

  test('repeated renders before the commit take a single lease', async () => {
    const { derived } = createRelayHarness();

    renderRead(derived);
    renderRead(derived);
    renderRead(derived);

    expect(derived.watchCount).toBe(1);
    expect(getRenderLeaseCount()).toBe(1);
  });

  test('a lease taken while paused holds no watch and releases none', async () => {
    const { counts, derived } = createRelayHarness();

    // A committed watcher elsewhere keeps the relay active.
    const other = reactiveSignal(() => derived.value) as unknown as ReactiveSignal<any, any>;
    const unsubscribeOther = other.addListener(() => {});
    await flush();
    expect(counts.active).toBe(1);
    const watchCount = derived.watchCount;

    renderRead(derived, false);
    expect(derived.watchCount).toBe(watchCount);

    await sleep(TTL * 2);
    await flush();

    expect(derived.watchCount).toBe(watchCount);
    expect(counts.active).toBe(1);

    unsubscribeOther();
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a claim after expiry watches again (late commit)', async () => {
    const { counts, derived } = createRelayHarness();

    const subscribe = renderRead(derived);
    await flush();

    await sleep(TTL * 2);
    await flush();
    expect(counts.active).toBe(0);

    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    await flush();

    expect(derived.watchCount).toBe(1);
    expect(counts.active).toBe(1);
    expect(counts.activations).toBe(2);
    expect(derived.value).toBe(1);

    unsubscribe();
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a signal can be leased again after its lease is claimed and released', async () => {
    const { counts, derived } = createRelayHarness();

    const subscribe = renderRead(derived);
    const unsubscribe = subscribe(() => {});
    unsubscribe();
    await flush();
    expect(counts.active).toBe(0);

    renderRead(derived);
    await flush();
    expect(counts.active).toBe(1);
    expect(getRenderLeaseCount()).toBe(1);

    await sleep(TTL * 2);
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a lease taken shortly before a sweep still lives a full TTL', async () => {
    const { derived: first } = createRelayHarness();
    const { counts, derived: second } = createRelayHarness();

    // Arms the wheel.
    renderRead(first);
    await sleep(TTL - 30);

    renderRead(second);
    await flush();

    // The first tick ages `second` into the old generation; it must survive it.
    await sleep(50);
    await flush();
    expect(counts.active).toBe(1);

    await sleep(TTL);
    await flush();
    expect(counts.active).toBe(0);
  });

  test('releaseRenderLeases releases every outstanding lease immediately', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    await flush();
    expect(counts.active).toBe(1);

    releaseRenderLeases();
    await flush();

    expect(getRenderLeaseCount()).toBe(0);
    expect(counts.active).toBe(0);
  });

  test('a suspended render keeps its lease until the thenable settles, then for a fresh TTL', async () => {
    const { counts, derived } = createRelayHarness();
    let resolve!: () => void;
    const pending = new Promise<void>(r => (resolve = r));

    renderRead(derived);
    holdLeaseUntilSettled(derived, pending);
    // Pinned leases still count as outstanding.
    expect(getRenderLeaseCount()).toBe(1);

    await sleep(TTL * 3);
    expect(counts.active).toBe(1);

    resolve();
    await pending;
    expect(getRenderLeaseCount()).toBe(1);

    await sleep(TTL - 40);
    expect(counts.active).toBe(1);

    await sleep(TTL + 50);
    expect(counts.active).toBe(0);
  });

  test('releaseRenderLeases releases pinned leases too', async () => {
    const { counts, derived } = createRelayHarness();
    const { counts: suspendedCounts, derived: suspended } = createRelayHarness();

    renderRead(derived);
    holdLeaseUntilSettled(derived, new Promise<void>(() => {}));
    renderRead(suspended);
    holdSuspendedLease(suspended);
    await flush();
    expect(getRenderLeaseCount()).toBe(2);

    releaseRenderLeases();
    await flush();

    expect(getRenderLeaseCount()).toBe(0);
    expect(counts.active).toBe(0);
    expect(suspendedCounts.active).toBe(0);
  });

  test('a render that reads a leased signal again extends its lease', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    await flush();

    // Keep re-rendering, each time within the TTL, for well past two TTLs.
    for (let i = 0; i < 6; i++) {
      await sleep(TTL / 2);
      renderRead(derived);
    }

    await flush();
    expect(counts.active).toBe(1);
    expect(counts.activations).toBe(1);

    await sleep(TTL * 2 + 50);
    await flush();
    expect(counts.active).toBe(0);
  });

  test('an un-paused render takes the watch for a lease an earlier render took while paused', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived, false);
    await flush();
    expect(counts.active).toBe(0);

    const subscribe = renderRead(derived, true);
    await flush();
    expect(counts.active).toBe(1);
    expect(derived.watchCount).toBe(1);

    // The claim keeps that watch, and the last unsubscribe drops it.
    const unsubscribe = subscribe(() => {});
    unsubscribe();
    await flush();
    expect(counts.active).toBe(0);
    expect(derived.watchCount).toBe(0);
  });

  test('a lease pinned for an opaque suspension holds until a render reads it again', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    holdSuspendedLease(derived);

    await sleep(TTL * 3);
    await flush();
    expect(counts.active).toBe(1);

    // React's retry re-reads the signal: the pin ends and the lease runs a normal TTL.
    renderRead(derived);
    await sleep(TTL * 2 + 50);
    await flush();
    expect(counts.active).toBe(0);
    expect(getRenderLeaseCount()).toBe(0);
  });

  test('a lease pinned for an opaque suspension is released by a new attempt at the same mount', async () => {
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    holdSuspendedLease(derived);

    await sleep(TTL * 3);
    expect(counts.active).toBe(1);

    releaseAbandonedAttempt(derived);
    await sleep(TTL * 2 + 50);
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a lease pinned for an opaque suspension React abandons is released after the hold', async () => {
    const shortTtl = 10;
    setConfig({ renderLeaseTtl: shortTtl });
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    holdSuspendedLease(derived);

    await sleep(shortTtl * 3);
    expect(counts.active).toBe(1);

    await sleep(shortTtl * (SUSPENDED_LEASE_HOLD_TTLS + 2) + 50);
    await flush();
    expect(counts.active).toBe(0);
  });

  test('a lease claimed while suspended is not renewed when the thenable settles', async () => {
    const { counts, derived } = createRelayHarness();
    let resolve!: () => void;
    const pending = new Promise<void>(r => (resolve = r));

    const subscribe = renderRead(derived);
    holdLeaseUntilSettled(derived, pending);
    const unsubscribe = subscribe(() => {});

    resolve();
    await pending;
    expect(getRenderLeaseCount()).toBe(0);

    await sleep(TTL * 2 + 20);
    expect(counts.active).toBe(1);

    unsubscribe();
    await flush();
    expect(counts.active).toBe(0);
  });

  test('keyed reactive signals shared by several renders are released once', async () => {
    const counts = { active: 0 };
    const source = reactive((id: number) =>
      relay<number>(state => {
        counts.active++;
        state.value = id;
        return () => {
          counts.active--;
        };
      }),
    );
    const read = reactiveSignal(() => source(1).value) as unknown as ReactiveSignal<any, any>;

    renderRead(read);
    renderRead(read);
    await flush();
    expect(counts.active).toBe(1);

    await sleep(TTL * 2);
    await flush();
    expect(counts.active).toBe(0);
    expect(read.watchCount).toBe(0);
  });
});

describe('renderLeaseTtl validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setConfig({ renderLeaseTtl: DEFAULT_RENDER_LEASE_TTL });
  });

  test('a TTL longer than the longest timer delay is clamped, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    setConfig({ renderLeaseTtl: Infinity });
    expect(getRenderLeaseTtl()).toBe(MAX_TIMEOUT);

    setConfig({ renderLeaseTtl: 2 ** 40 });
    expect(getRenderLeaseTtl()).toBe(MAX_TIMEOUT);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a TTL that is not a positive number is ignored, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setConfig({ renderLeaseTtl: 500 });

    for (const ttl of [0, -1, NaN]) {
      setConfig({ renderLeaseTtl: ttl });
      expect(getRenderLeaseTtl()).toBe(500);
    }

    expect(warn).toHaveBeenCalledTimes(3);
  });

  test('a clamped TTL does not release leases immediately', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setConfig({ renderLeaseTtl: Infinity });
    const { counts, derived } = createRelayHarness();

    renderRead(derived);
    await sleep(20);
    expect(counts.active).toBe(1);

    releaseRenderLeases();
    await flush();
    expect(counts.active).toBe(0);
  });
});

describe('retain()', () => {
  test('keeps relays active for the TTL, then releases them', async () => {
    const { counts, derived } = createRelayHarness();

    retain(() => derived.value, { ttl: 60 });
    expect(counts.active).toBe(1);

    await sleep(30);
    expect(counts.active).toBe(1);

    await sleep(60);
    expect(counts.active).toBe(0);
  });

  test('release() ends the retention early and is idempotent', async () => {
    const { counts, derived } = createRelayHarness();

    const release = retain(() => derived.value, { ttl: 10_000 });
    expect(counts.active).toBe(1);

    release();
    release();
    await sleep(5);
    expect(counts.active).toBe(0);
  });

  test('tracks reads after an await in an async fn', async () => {
    const { counts, derived } = createRelayHarness();

    const release = retain(async () => {
      await sleep(1);
      return derived.value;
    });
    await sleep(20);
    expect(counts.active).toBe(1);

    release();
    await flush();
    expect(counts.active).toBe(0);
  });

  test('ttl: Infinity retains until released', async () => {
    const { counts, derived } = createRelayHarness();

    const release = retain(() => derived.value, { ttl: Infinity });
    await sleep(30);
    expect(counts.active).toBe(1);

    release();
    await sleep(5);
    expect(counts.active).toBe(0);
  });

  test('a ttl longer than the longest timer delay is clamped instead of releasing at once', async () => {
    const { counts, derived } = createRelayHarness();

    const release = retain(() => derived.value, { ttl: 2 ** 40 });
    await sleep(30);
    expect(counts.active).toBe(1);

    release();
    await sleep(5);
    expect(counts.active).toBe(0);
  });

  test('a negative or NaN ttl throws', () => {
    const { counts, derived } = createRelayHarness();

    expect(() => retain(() => derived.value, { ttl: -1 })).toThrow(RangeError);
    expect(() => retain(() => derived.value, { ttl: NaN })).toThrow(RangeError);
    expect(counts.active).toBe(0);
  });

  test('a render that mounts while retained reuses the warm relay', async () => {
    const { counts, derived } = createRelayHarness();

    const release = retain(() => derived.value);
    await sleep(5);

    const unsubscribe = derived.addListener(() => {});
    release();
    await sleep(5);

    expect(counts.active).toBe(1);
    expect(counts.activations).toBe(1);

    unsubscribe();
    await sleep(5);
    expect(counts.active).toBe(0);
  });
});
