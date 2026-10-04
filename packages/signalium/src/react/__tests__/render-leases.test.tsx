import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { startTransition, StrictMode, Suspense, use, useState, useSyncExternalStore } from 'react';
import { reactive, relay, signal } from 'signalium';
import { setConfig } from 'signalium/config';
import { component, PauseSignalsProvider, useReactive, useReactiveShallow } from 'signalium/react';
import { sleep } from '../../__tests__/utils/async.js';

/**
 * Render-time watches are provisional leases: a render React never commits (an interrupted
 * transition, a mount that suspends, StrictMode's discarded double render) must stop holding its
 * relays once the lease expires, while a render that commits claims its lease without restarting
 * anything.
 */

const LEASE_TTL = 150;
const DEFAULT_LEASE_TTL = 10_000;

const LEAF_IDS = [0, 1, 2, 3, 4];
const LEAF_COUNT = LEAF_IDS.length;

// Lets scheduled deactivations (and any pending pulls) flush.
const settle = () => sleep(50);
// A lease lives between one and two TTLs; wait past the upper bound.
const expireLeases = () => sleep(LEASE_TTL * 2 + 100);

type Counts = { bodyRuns: number; activeRelays: number; activations: number };

function createHarness() {
  const counts: Counts = { bodyRuns: 0, activeRelays: 0, activations: 0 };

  const leafRelay = reactive((id: number) =>
    relay<number>(state => {
      counts.activeRelays++;
      counts.activations++;
      state.value = id;

      return () => {
        counts.activeRelays--;
      };
    }),
  );

  return { counts, leafRelay };
}

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin so the concurrent render has to yield between leaves
  }
}

/** An external store whose tick is an urgent (SyncLane) update for every subscriber. */
function createTicker() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    tick() {
      value++;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get: () => value,
  };
}

type LeafComponent = (props: { id: number }) => React.ReactNode;

/**
 * Mounts `Leaf`s inside a transition and ticks a `useSyncExternalStore` store from a timer while
 * the time-sliced render is yielded, so React throws the in-progress transition away (every leaf
 * mounted so far is discarded) and restarts it. Leaves must call `onLeafBody()` in their body.
 */
function createInterruptedTransition() {
  const ticker = createTicker();
  let ticked = false;
  let show: (value: boolean) => void = () => {};

  const onLeafBody = () => {
    busyWait(8);
    if (!ticked) {
      ticked = true;
      setTimeout(() => ticker.tick(), 0);
    }
  };

  function Ticker() {
    const value = useSyncExternalStore(ticker.subscribe, ticker.get);
    return <span data-testid="ticks">{value}</span>;
  }

  async function mount(
    Leaf: LeafComponent,
    counts: Counts,
    wrap: (children: React.ReactNode) => React.ReactNode = c => c,
  ) {
    function Host() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      return wrap(
        <div>
          <Ticker />
          <Suspense fallback={null}>
            {visible ? LEAF_IDS.map(id => <Leaf key={id} id={id} />) : <span data-testid="empty">empty</span>}
          </Suspense>
        </div>,
      );
    }

    const result = render(<Host />);
    await expect.element(result.getByTestId('empty')).toBeInTheDocument();

    startTransition(() => show(true));

    await expect.element(result.getByTestId('leaf-4')).toHaveTextContent('4');
    await settle();

    // The scenario only means something if React really discarded leaf renders.
    expect(counts.bodyRuns).toBeGreaterThan(LEAF_COUNT);

    return result;
  }

  return { onLeafBody, mount, hide: () => startTransition(() => show(false)) };
}

/**
 * Shared assertions: the committed leaves hold exactly one activation each (no restart across the
 * render → commit gap), unmounting them releases everything once the discarded renders' leases
 * expire, and nothing stays active.
 */
async function expectNoLeakAfterUnmount(
  counts: Counts,
  scenario: { hide: () => void },
  result: { getByTestId: (id: string) => any },
) {
  expect(counts.activeRelays).toBe(LEAF_COUNT);
  expect(counts.activations).toBe(LEAF_COUNT);

  scenario.hide();
  await expect.element(result.getByTestId('empty')).toBeInTheDocument();
  await settle();
  const leakedBeforeTtl = counts.activeRelays;

  await expireLeases();
  await settle();

  return { leakedBeforeTtl, leakedAfterTtl: counts.activeRelays };
}

describe('React > render leases', () => {
  beforeAll(() => {
    setConfig({ renderLeaseTtl: LEASE_TTL });
  });

  afterAll(() => {
    setConfig({ renderLeaseTtl: DEFAULT_LEASE_TTL });
  });

  describe('interrupted transition', () => {
    test('useReactive', async () => {
      const { counts, leafRelay } = createHarness();
      const scenario = createInterruptedTransition();

      function Leaf({ id }: { id: number }) {
        counts.bodyRuns++;
        scenario.onLeafBody();
        const value = useReactive(() => leafRelay(id).value);
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      }

      const result = await scenario.mount(Leaf, counts);
      const { leakedBeforeTtl, leakedAfterTtl } = await expectNoLeakAfterUnmount(counts, scenario, result);
      console.log(`[leases] interrupted transition useReactive: leaked ${leakedBeforeTtl} -> ${leakedAfterTtl}`);
      expect(leakedAfterTtl).toBe(0);
      expect(counts.activations).toBe(LEAF_COUNT);
    });

    test('useReactiveShallow', async () => {
      const { counts, leafRelay } = createHarness();
      const scenario = createInterruptedTransition();
      const readers = LEAF_IDS.map(id => () => leafRelay(id).value);

      function Leaf({ id }: { id: number }) {
        counts.bodyRuns++;
        scenario.onLeafBody();
        const value = useReactiveShallow(readers[id]);
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      }

      const result = await scenario.mount(Leaf, counts);
      const { leakedBeforeTtl, leakedAfterTtl } = await expectNoLeakAfterUnmount(counts, scenario, result);
      console.log(`[leases] interrupted transition useReactiveShallow: leaked ${leakedBeforeTtl} -> ${leakedAfterTtl}`);
      expect(leakedAfterTtl).toBe(0);
      expect(counts.activations).toBe(LEAF_COUNT);
    });

    test('sync component()', async () => {
      const { counts, leafRelay } = createHarness();
      const scenario = createInterruptedTransition();

      const Leaf = component(({ id }: { id: number }) => {
        counts.bodyRuns++;
        scenario.onLeafBody();
        return <span data-testid={`leaf-${id}`}>{leafRelay(id).value}</span>;
      });

      const result = await scenario.mount(Leaf, counts);
      const { leakedBeforeTtl, leakedAfterTtl } = await expectNoLeakAfterUnmount(counts, scenario, result);
      console.log(`[leases] interrupted transition component(): leaked ${leakedBeforeTtl} -> ${leakedAfterTtl}`);
      expect(leakedAfterTtl).toBe(0);
      expect(counts.activations).toBe(LEAF_COUNT);
    });

    test('async component()', async () => {
      const { counts, leafRelay } = createHarness();
      const scenario = createInterruptedTransition();

      const Leaf = component(async ({ id }: { id: number }) => {
        counts.bodyRuns++;
        scenario.onLeafBody();
        return <span data-testid={`leaf-${id}`}>{leafRelay(id).value}</span>;
      });

      const result = await scenario.mount(Leaf, counts);
      const { leakedBeforeTtl, leakedAfterTtl } = await expectNoLeakAfterUnmount(counts, scenario, result);
      console.log(`[leases] interrupted transition async component(): leaked ${leakedBeforeTtl} -> ${leakedAfterTtl}`);
      expect(leakedAfterTtl).toBe(0);
      expect(counts.activations).toBe(LEAF_COUNT);
    });
  });

  describe('PauseSignalsProvider', () => {
    const cases: [string, (relayFor: (id: number) => number | undefined, onBody: () => void) => LeafComponent][] = [
      [
        'useReactive',
        (relayFor, onBody) =>
          function Leaf({ id }: { id: number }) {
            onBody();
            const value = useReactive(() => relayFor(id));
            return <span data-testid={`leaf-${id}`}>{value}</span>;
          },
      ],
      [
        'useReactiveShallow',
        (relayFor, onBody) => {
          const readers = LEAF_IDS.map(id => () => relayFor(id));
          return function Leaf({ id }: { id: number }) {
            onBody();
            const value = useReactiveShallow(readers[id]);
            return <span data-testid={`leaf-${id}`}>{value}</span>;
          };
        },
      ],
      [
        'component()',
        (relayFor, onBody) =>
          component(({ id }: { id: number }) => {
            onBody();
            return <span data-testid={`leaf-${id}`}>{relayFor(id)}</span>;
          }),
      ],
    ];

    for (const [name, makeLeaf] of cases) {
      test(`${name}: un-pausing does not re-watch a discarded render`, async () => {
        const { counts, leafRelay } = createHarness();
        const scenario = createInterruptedTransition();
        let setPaused: (value: boolean) => void = () => {};

        const Leaf = makeLeaf(
          id => leafRelay(id).value,
          () => {
            counts.bodyRuns++;
            scenario.onLeafBody();
          },
        );

        function PauseHost({ children }: { children: React.ReactNode }) {
          const [paused, _setPaused] = useState(false);
          setPaused = _setPaused;
          return <PauseSignalsProvider value={paused}>{children}</PauseSignalsProvider>;
        }

        const result = await scenario.mount(Leaf, counts, children => <PauseHost>{children}</PauseHost>);

        // Let the discarded renders' leases expire first, then cycle the pause state.
        await expireLeases();
        await settle();
        expect(counts.activeRelays).toBe(LEAF_COUNT);

        React.act(() => setPaused(true));
        await settle();
        expect(counts.activeRelays).toBe(0);

        React.act(() => setPaused(false));
        await settle();
        expect(counts.activeRelays).toBe(LEAF_COUNT);

        scenario.hide();
        await expect.element(result.getByTestId('empty')).toBeInTheDocument();
        await settle();
        await expireLeases();
        await settle();

        console.log(`[leases] pause cycle ${name}: leaked ${counts.activeRelays}`);
        expect(counts.activeRelays).toBe(0);
      });
    }
  });

  describe('suspended mount', () => {
    test('async component() keeps its lease while suspended longer than the TTL', async () => {
      const { counts, leafRelay } = createHarness();
      let resolveGate!: () => void;
      const gate = new Promise<void>(r => (resolveGate = r));
      let show: (value: boolean) => void = () => {};

      const Leaf = component(async ({ id }: { id: number }) => {
        counts.bodyRuns++;
        const value = leafRelay(id).value;
        await gate;
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      });

      function Host() {
        const [visible, setVisible] = useState(true);
        show = setVisible;
        return (
          <Suspense fallback={<span data-testid="fallback">loading</span>}>
            {visible ? <Leaf id={1} /> : <span data-testid="empty">empty</span>}
          </Suspense>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('fallback')).toBeInTheDocument();

      // Suspended for well past the lease lifetime: the relay must stay warm.
      await expireLeases();
      await expireLeases();
      expect(counts.activeRelays).toBe(1);

      resolveGate();
      await expect.element(getByTestId('leaf-1')).toHaveTextContent('1');
      await settle();

      expect(counts.activeRelays).toBe(1);
      expect(counts.activations).toBe(1);

      React.act(() => show(false));
      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await expireLeases();
      await settle();
      expect(counts.activeRelays).toBe(0);
    });

    test('async component() that suspends on mount releases the discarded attempt', async () => {
      const { counts, leafRelay } = createHarness();
      let resolveGate!: () => void;
      const gate = new Promise<void>(r => (resolveGate = r));
      let show: (value: boolean) => void = () => {};

      const Leaf = component(async ({ id }: { id: number }) => {
        counts.bodyRuns++;
        const value = leafRelay(id).value;
        await gate;
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      });

      function Host() {
        const [visible, setVisible] = useState(true);
        show = setVisible;
        return (
          <Suspense fallback={<span data-testid="fallback">loading</span>}>
            {visible ? <Leaf id={1} /> : <span data-testid="empty">empty</span>}
          </Suspense>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('fallback')).toBeInTheDocument();
      await settle();

      resolveGate();
      await expect.element(getByTestId('leaf-1')).toHaveTextContent('1');
      await settle();

      expect(counts.bodyRuns).toBeGreaterThan(1);
      expect(counts.activeRelays).toBe(1);
      // The retry re-used the relay the suspended attempt kept warm.
      expect(counts.activations).toBe(1);

      React.act(() => show(false));
      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();
      const leakedBeforeTtl = counts.activeRelays;

      await expireLeases();
      await settle();
      console.log(`[leases] suspended mount async component(): leaked ${leakedBeforeTtl} -> ${counts.activeRelays}`);
      expect(counts.activeRelays).toBe(0);
    });

    test('useReactive under a sibling that suspends on mount releases the discarded attempt', async () => {
      const { counts, leafRelay } = createHarness();
      let resolveGate!: () => void;
      let gateResolved = false;
      const gate = new Promise<void>(r => (resolveGate = r)).then(() => {
        gateResolved = true;
      });
      let show: (value: boolean) => void = () => {};

      function Leaf({ id }: { id: number }) {
        counts.bodyRuns++;
        const value = useReactive(() => leafRelay(id).value);
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      }

      function Suspender() {
        if (!gateResolved) throw gate;
        return null;
      }

      function Host() {
        const [visible, setVisible] = useState(true);
        show = setVisible;
        return (
          <Suspense fallback={<span data-testid="fallback">loading</span>}>
            {visible ? (
              <>
                <Leaf id={1} />
                <Suspender />
              </>
            ) : (
              <span data-testid="empty">empty</span>
            )}
          </Suspense>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('fallback')).toBeInTheDocument();
      await settle();

      resolveGate();
      await expect.element(getByTestId('leaf-1')).toHaveTextContent('1');
      await settle();

      expect(counts.activeRelays).toBe(1);
      expect(counts.activations).toBe(1);

      React.act(() => show(false));
      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();
      const leakedBeforeTtl = counts.activeRelays;

      await expireLeases();
      await settle();
      console.log(`[leases] suspended mount useReactive: leaked ${leakedBeforeTtl} -> ${counts.activeRelays}`);
      expect(counts.activeRelays).toBe(0);
    });
  });

  describe('PauseSignalsProvider: pause state changes between render and commit', () => {
    type Kind = 'useReactive' | 'useReactiveShallow' | 'component()';
    const kinds: Kind[] = ['useReactive', 'useReactiveShallow', 'component()'];

    function makeReader(kind: Kind, read: () => unknown) {
      if (kind === 'component()') {
        return component(() => <span data-testid="reader">{String(read())}</span>);
      }

      const useRead = kind === 'useReactive' ? useReactive : useReactiveShallow;

      return function Reader() {
        const value = useRead(read);
        return <span data-testid="reader">{String(value)}</span>;
      };
    }

    /**
     * Renders `Reader` under a pause provider next to a sibling that suspends on mount, so the
     * reader's render (and its lease) happens long before its commit, when `release()` is called.
     */
    function mountSuspendedUnderPause(Reader: () => React.ReactNode, initiallyPaused: boolean) {
      let release!: () => void;
      const gate = new Promise<void>(r => (release = r));
      let setPaused: (value: boolean) => void = () => {};
      let setShown: (value: boolean) => void = () => {};

      function Gate() {
        use(gate);
        return null;
      }

      function Host() {
        const [paused, _setPaused] = useState(initiallyPaused);
        const [shown, _setShown] = useState(true);
        setPaused = _setPaused;
        setShown = _setShown;
        return (
          <PauseSignalsProvider value={paused}>
            <span data-testid="paused">{String(paused)}</span>
            {shown ? (
              <Suspense fallback={<span data-testid="fallback">loading</span>}>
                <Reader />
                <Gate />
              </Suspense>
            ) : (
              <span data-testid="hidden">hidden</span>
            )}
          </PauseSignalsProvider>
        );
      }

      const result = render(<Host />);

      return {
        result,
        release,
        setPaused: (value: boolean) => setPaused(value),
        unmountReader: () => setShown(false),
      };
    }

    for (const kind of kinds) {
      test(`${kind}: rendered paused and committed un-paused, it receives updates`, async () => {
        const source = signal(1);
        const derived = reactive(() => source.value * 10);
        const { result, release, setPaused } = mountSuspendedUnderPause(
          makeReader(kind, () => derived()),
          true,
        );

        await expect.element(result.getByTestId('fallback')).toBeInTheDocument();
        await settle();

        setPaused(false);
        await expect.element(result.getByTestId('paused')).toHaveTextContent('false');
        await settle();

        release();
        await expect.element(result.getByTestId('reader')).toHaveTextContent('10');
        await settle();

        source.value = 2;
        await expect.element(result.getByTestId('reader')).toHaveTextContent('20');
      });

      test(`${kind}: rendered un-paused and committed paused, it holds no watch while paused or after unmount`, async () => {
        const { counts, leafRelay } = createHarness();
        const { result, release, setPaused, unmountReader } = mountSuspendedUnderPause(
          makeReader(kind, () => leafRelay(1).value),
          false,
        );

        await expect.element(result.getByTestId('fallback')).toBeInTheDocument();
        await settle();
        expect(counts.activeRelays).toBe(1);

        setPaused(true);
        await expect.element(result.getByTestId('paused')).toHaveTextContent('true');
        await settle();

        release();
        await expect.element(result.getByTestId('reader')).toHaveTextContent('1');
        await settle();
        await expireLeases();
        await settle();
        const activeWhilePaused = counts.activeRelays;

        setPaused(false);
        await expect.element(result.getByTestId('paused')).toHaveTextContent('false');
        await settle();
        const activeAfterUnpause = counts.activeRelays;

        unmountReader();
        await expect.element(result.getByTestId('hidden')).toBeInTheDocument();
        await settle();
        await expireLeases();
        await settle();

        expect({ activeWhilePaused, activeAfterUnpause, activeAfterUnmount: counts.activeRelays }).toEqual({
          activeWhilePaused: 0,
          activeAfterUnpause: 1,
          activeAfterUnmount: 0,
        });
      });
    }
  });

  describe('PauseSignalsProvider: a useReactiveShallow signal shared by several readers', () => {
    test('pausing still pauses the remaining reader after another unmounts', async () => {
      const { counts, leafRelay } = createHarness();
      const read = () => leafRelay(1).value;
      let setPaused: (value: boolean) => void = () => {};
      let setShowFirst: (value: boolean) => void = () => {};
      let setShowSecond: (value: boolean) => void = () => {};

      function Reader({ id }: { id: string }) {
        const value = useReactiveShallow(read);
        return <span data-testid={id}>{value}</span>;
      }

      function Host() {
        const [paused, _setPaused] = useState(false);
        const [showFirst, _setShowFirst] = useState(true);
        const [showSecond, _setShowSecond] = useState(true);
        setPaused = _setPaused;
        setShowFirst = _setShowFirst;
        setShowSecond = _setShowSecond;
        return (
          <PauseSignalsProvider value={paused}>
            {showFirst ? <Reader id="first" /> : null}
            {showSecond ? <Reader id="second" /> : null}
          </PauseSignalsProvider>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('second')).toHaveTextContent('1');
      await settle();
      expect(counts.activeRelays).toBe(1);

      React.act(() => setShowFirst(false));
      await settle();
      expect(counts.activeRelays).toBe(1);

      React.act(() => setPaused(true));
      await settle();
      expect(counts.activeRelays).toBe(0);

      React.act(() => setPaused(false));
      await settle();
      expect(counts.activeRelays).toBe(1);
      expect(counts.activations).toBe(2);

      React.act(() => setShowSecond(false));
      await settle();
      await expireLeases();
      await settle();
      expect(counts.activeRelays).toBe(0);
    });
  });

  describe('StrictMode', () => {
    test('mount + unmount leaks nothing', async () => {
      const { counts, leafRelay } = createHarness();

      const SyncLeaf = component(({ id }: { id: number }) => (
        <span data-testid={`sync-${id}`}>{leafRelay(id).value}</span>
      ));
      const AsyncLeaf = component(async ({ id }: { id: number }) => (
        <span data-testid={`async-${id}`}>{leafRelay(id).value}</span>
      ));
      function HookLeaf({ id }: { id: number }) {
        const value = useReactive(() => leafRelay(id).value);
        return <span data-testid={`hook-${id}`}>{value}</span>;
      }

      const { getByTestId, unmount } = render(
        <StrictMode>
          <Suspense fallback={null}>
            <SyncLeaf id={1} />
            <AsyncLeaf id={2} />
            <HookLeaf id={3} />
          </Suspense>
        </StrictMode>,
      );

      await expect.element(getByTestId('hook-3')).toHaveTextContent('3');
      await settle();
      expect(counts.activeRelays).toBe(3);

      // Committed StrictMode components must survive lease expiry.
      await expireLeases();
      await settle();
      expect(counts.activeRelays).toBe(3);
      expect(counts.activations).toBe(3);

      unmount();
      await settle();
      const leakedBeforeTtl = counts.activeRelays;

      await expireLeases();
      await settle();
      console.log(`[leases] StrictMode: leaked ${leakedBeforeTtl} -> ${counts.activeRelays}`);
      expect(counts.activeRelays).toBe(0);
    });
  });

  describe('committed renders', () => {
    test('claimed leases outlive the TTL and the relay never restarts', async () => {
      const { counts, leafRelay } = createHarness();
      let show: (value: boolean) => void = () => {};

      const SyncLeaf = component(({ id }: { id: number }) => (
        <span data-testid={`sync-${id}`}>{leafRelay(id).value}</span>
      ));
      function HookLeaf({ id }: { id: number }) {
        const value = useReactive(() => leafRelay(id).value);
        return <span data-testid={`hook-${id}`}>{value}</span>;
      }

      function Host() {
        const [visible, setVisible] = useState(false);
        show = setVisible;
        return visible ? (
          <>
            <SyncLeaf id={1} />
            <HookLeaf id={2} />
          </>
        ) : (
          <span data-testid="empty">empty</span>
        );
      }

      const { getByTestId } = render(<Host />);
      startTransition(() => show(true));
      await expect.element(getByTestId('hook-2')).toHaveTextContent('2');

      await expireLeases();
      await settle();
      expect(counts.activeRelays).toBe(2);
      expect(counts.activations).toBe(2);

      startTransition(() => show(false));
      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();
      expect(counts.activeRelays).toBe(0);
    });
  });
});
