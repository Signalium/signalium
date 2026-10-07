import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { Profiler, startTransition, StrictMode, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { reactive, relay, signal } from 'signalium';
import { setConfig } from 'signalium/config';
import { component, useReactive, useReactiveShallow, type ReactDelivery } from 'signalium/react';
import { getRenderLeaseCount } from 'signalium/debug';
import { sleep } from '../../__tests__/utils/async.js';

/**
 * `delivery: 'state'` delivers signal changes to React with a default-priority `setState` instead
 * of a `useSyncExternalStore` (SyncLane) store change. A transition then finishes while live data
 * keeps ticking underneath it, instead of being restarted by every tick.
 */

const LEASE_TTL = 150;
const DEFAULT_LEASE_TTL = 10_000;

const settle = () => sleep(50);

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin so the concurrent render has to yield
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (!condition() && performance.now() < deadline) {
    await sleep(5);
  }
  return condition();
}

type ReaderKind = 'component' | 'useReactive' | 'useReactiveShallow';
const READER_KINDS: ReaderKind[] = ['component', 'useReactive', 'useReactiveShallow'];

/**
 * Builds a leaf that renders `source()` with the given reader and delivery override, counting its
 * renders and recording every value it commits.
 */
function createLeaf(
  kind: ReaderKind,
  source: () => number,
  delivery: ReactDelivery | undefined,
  stats: { renders: number; committed: number[] },
) {
  const options = delivery === undefined ? undefined : { delivery };

  function Commit({ value, testId }: { value: number; testId: string }) {
    useLayoutEffect(() => {
      stats.committed.push(value);
    });
    return <span data-testid={testId}>{value}</span>;
  }

  if (kind === 'component') {
    return component(({ testId }: { testId: string }) => {
      stats.renders++;
      return <Commit value={source()} testId={testId} />;
    }, options);
  }

  if (kind === 'useReactive') {
    return function Leaf({ testId }: { testId: string }) {
      stats.renders++;
      const value = useReactive(() => source(), options);
      return <Commit value={value} testId={testId} />;
    };
  }

  return function Leaf({ testId }: { testId: string }) {
    stats.renders++;
    const value = useReactiveShallow(source, options);
    return <Commit value={value} testId={testId} />;
  };
}

const LIVE_LEAVES = 5;
const HEAVY_ROWS = 40;
const HEAVY_ROW_MS = 2;
const TICK_MS = 4;

function HeavyRow({ i }: { i: number }) {
  busyWait(HEAVY_ROW_MS);
  return <span>{i}</span>;
}

/**
 * The transition-under-ticker repro: live leaves read a signal ticked every `TICK_MS`, while a
 * transition mounts ~80 ms of time-sliced render work. Returns how long the transition took to
 * commit (or `null` if it did not commit within `budgetMs`) and how many leaf renders happened
 * meanwhile.
 */
async function transitionUnderTicker(kind: ReaderKind, delivery: ReactDelivery | undefined, budgetMs: number) {
  const live = signal(0);
  const source = () => live.value;
  const stats = { renders: 0, committed: [] as number[] };
  const Leaf = createLeaf(kind, source, delivery, stats);

  let committedAt: number | undefined;
  let show: (value: boolean) => void = () => {};

  function Heavy() {
    useLayoutEffect(() => {
      committedAt = performance.now();
    }, []);
    return (
      <div data-testid="heavy">
        {Array.from({ length: HEAVY_ROWS }, (_, i) => (
          <HeavyRow key={i} i={i} />
        ))}
      </div>
    );
  }

  function Host() {
    const [visible, setVisible] = useState(false);
    show = setVisible;
    return (
      <div>
        {Array.from({ length: LIVE_LEAVES }, (_, i) => (
          <Leaf key={i} testId={`live-${i}`} />
        ))}
        {visible ? <Heavy /> : <span data-testid="idle">idle</span>}
      </div>
    );
  }

  const result = render(<Host />);
  await expect.element(result.getByTestId('idle')).toBeInTheDocument();

  const interval = setInterval(() => live.value++, TICK_MS);
  // Let the ticker reach steady state.
  await sleep(50);
  await expect.element(result.getByTestId('live-0')).not.toHaveTextContent('0');

  const rendersBefore = stats.renders;
  const start = performance.now();
  startTransition(() => show(true));

  await waitFor(() => committedAt !== undefined, budgetMs);

  const latency = committedAt === undefined ? null : committedAt - start;
  const leafRenders = stats.renders - rendersBefore;

  clearInterval(interval);

  // Without the ticker the transition always finishes; the live leaves must show the final value.
  await expect.element(result.getByTestId('heavy')).toBeInTheDocument();
  await settle();
  for (let i = 0; i < LIVE_LEAVES; i++) {
    await expect.element(result.getByTestId(`live-${i}`)).toHaveTextContent(String(live.value));
  }

  result.unmount();

  return { latency, leafRenders };
}

describe('React > state delivery', () => {
  beforeAll(() => {
    setConfig({ renderLeaseTtl: LEASE_TTL });
  });

  afterAll(() => {
    setConfig({ renderLeaseTtl: DEFAULT_LEASE_TTL });
  });

  afterEach(() => {
    setConfig({ reactDelivery: 'sync' });
  });

  describe('transition under a live ticker', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: 'state' lets the transition commit while live data ticks`, async () => {
        const { latency, leafRenders } = await transitionUnderTicker(kind, 'state', 1500);
        console.log(
          `[delivery] ${kind} state: transition committed in ${latency?.toFixed(0)} ms, ${leafRenders} leaf renders`,
        );
        expect(latency).not.toBeNull();
        // ~80 ms of render work; generous bound for CI noise, far below the sync expiry.
        expect(latency!).toBeLessThan(400);
      });

      test(`${kind}: 'sync' restarts the transition on every tick`, async () => {
        const { latency, leafRenders } = await transitionUnderTicker(kind, 'sync', 600);
        console.log(
          `[delivery] ${kind} sync: transition ${latency === null ? 'did not commit in 600 ms' : `committed in ${latency.toFixed(0)} ms`}, ${leafRenders} leaf renders`,
        );
        expect(latency).toBeNull();
      });
    }

    test("global reactDelivery: 'state' applies to readers without an override", async () => {
      setConfig({ reactDelivery: 'state' });
      const { latency } = await transitionUnderTicker('component', undefined, 1500);
      expect(latency).not.toBeNull();
      expect(latency!).toBeLessThan(400);
    });

    test("a per-call delivery: 'sync' overrides a global 'state'", async () => {
      setConfig({ reactDelivery: 'state' });
      const { latency } = await transitionUnderTicker('useReactive', 'sync', 600);
      expect(latency).toBeNull();
    });
  });

  describe('no lost updates', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: a change between render and subscribe is delivered`, async () => {
        const live = signal(0);
        const stats = { renders: 0, committed: [] as number[] };
        const Leaf = createLeaf(kind, () => live.value, 'state', stats);

        // Rendered before the leaf, so its layout effect runs after the leaf rendered but before the
        // leaf subscribes.
        function Setter() {
          useLayoutEffect(() => {
            live.value = 1;
          }, []);
          return null;
        }

        const result = render(
          <>
            <Setter />
            <Leaf testId="leaf" />
          </>,
        );

        await expect.element(result.getByTestId('leaf')).toHaveTextContent('1');
        expect(stats.committed[0]).toBe(0);
        expect(stats.committed.at(-1)).toBe(1);
        result.unmount();
      });

      test(`${kind}: a change that is fully flushed while a transition render is pending is delivered`, async () => {
        const live = signal(0);
        const shared = reactive(() => live.value);
        const early = { renders: 0, committed: [] as number[] };
        const late = { renders: 0, committed: [] as number[] };
        // An already-mounted reader of the same signal consumes the notification before the late
        // reader subscribes.
        const Early = createLeaf(kind, shared, 'state', early);
        const Late = createLeaf(kind, shared, 'state', late);

        let changed = false;
        let show: (value: boolean) => void = () => {};

        function Trigger() {
          // Runs during the transition render, after Late rendered with 0.
          if (!changed) {
            changed = true;
            setTimeout(() => (live.value = 1), 0);
          }
          return null;
        }

        function Host() {
          const [visible, setVisible] = useState(false);
          show = setVisible;
          return (
            <div>
              <Early testId="early" />
              {visible && (
                <>
                  <Late testId="late" />
                  <Trigger />
                  {Array.from({ length: 30 }, (_, i) => (
                    <HeavyRow key={i} i={i} />
                  ))}
                </>
              )}
            </div>
          );
        }

        const result = render(<Host />);
        await expect.element(result.getByTestId('early')).toHaveTextContent('0');

        startTransition(() => show(true));

        await expect.element(result.getByTestId('late')).toHaveTextContent('1');
        await expect.element(result.getByTestId('early')).toHaveTextContent('1');
        // The scenario only means something if the late reader committed the stale value first.
        expect(late.committed[0]).toBe(0);
        result.unmount();
      });
    }
  });

  describe('batching', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: one notify burst across N readers is one commit`, async () => {
        const N = 20;
        const sources = Array.from({ length: N }, () => signal(0));
        const statsList = sources.map(() => ({ renders: 0, committed: [] as number[] }));
        const leaves = sources.map((s, i) => createLeaf(kind, () => s.value, 'state', statsList[i]));

        let commits = 0;
        const result = render(
          <Profiler id="leaves" onRender={() => commits++}>
            {leaves.map((Leaf, i) => (
              <Leaf key={i} testId={`leaf-${i}`} />
            ))}
          </Profiler>,
        );
        await expect.element(result.getByTestId(`leaf-${N - 1}`)).toHaveTextContent('0');
        await settle();

        const commitsBefore = commits;
        const rendersBefore = statsList.map(s => s.renders);

        // Several writes per signal in one task.
        for (const s of sources) {
          s.value = 1;
          s.value = 2;
          s.value = 3;
        }

        await expect.element(result.getByTestId(`leaf-${N - 1}`)).toHaveTextContent('3');
        await settle();

        expect(commits - commitsBefore).toBe(1);
        statsList.forEach((s, i) => expect(s.renders - rendersBefore[i]).toBe(1));
        result.unmount();
      });
    }

    test('notifications spread over several signal flushes before React renders coalesce per reader', async () => {
      const live = signal(0);
      const stats = { renders: 0, committed: [] as number[] };
      const Leaf = createLeaf('component', () => live.value, 'state', stats);

      // Hold the delivery flush so several signal flushes land before it.
      let flush: (() => void) | undefined;
      setConfig({ scheduleReactDelivery: fn => (flush = fn) });

      try {
        const result = render(<Leaf testId="leaf" />);
        await expect.element(result.getByTestId('leaf')).toHaveTextContent('0');
        await settle();
        flush?.();
        flush = undefined;
        await settle();

        const before = stats.renders;
        live.value = 1;
        await settle();
        live.value = 2;
        await settle();
        live.value = 3;
        await settle();

        expect(stats.renders).toBe(before);
        expect(flush).toBeDefined();
        flush!();

        await expect.element(result.getByTestId('leaf')).toHaveTextContent('3');
        expect(stats.renders - before).toBe(1);
        result.unmount();
      } finally {
        setConfig({ scheduleReactDelivery: fn => void Promise.resolve().then(fn) });
      }
    });
  });

  describe('freshness', () => {
    test('a render for another reason reads the current value and skips the pending delivery', async () => {
      const live = signal(0);
      const stats = { renders: 0, committed: [] as number[] };
      const Leaf = createLeaf('useReactive', () => live.value, 'state', stats);

      let bump: () => void = () => {};
      function Host() {
        const [n, setN] = useState(0);
        bump = () => setN(n + 1);
        return <Leaf testId="leaf" />;
      }

      const result = render(<Host />);
      await expect.element(result.getByTestId('leaf')).toHaveTextContent('0');
      await settle();

      const before = stats.renders;
      live.value = 1;
      // Render synchronously before any signal flush or delivery runs.
      flushSync(() => bump());
      expect(stats.committed.at(-1)).toBe(1);

      await settle();
      // The delivery saw the committed version was already current and did not render again.
      expect(stats.renders - before).toBe(1);
      result.unmount();
    });
  });

  describe('lifecycle', () => {
    function createRelayHarness() {
      const counts = { active: 0, activations: 0 };
      const leafRelay = reactive((id: number) =>
        relay<number>(state => {
          counts.active++;
          counts.activations++;
          state.value = id;
          return () => {
            counts.active--;
          };
        }),
      );
      return { counts, leafRelay };
    }

    for (const kind of READER_KINDS) {
      test(`${kind}: unmount unsubscribes and drops pending deliveries`, async () => {
        const { counts, leafRelay } = createRelayHarness();
        const live = signal(0);
        const stats = { renders: 0, committed: [] as number[] };
        const reader = () => (leafRelay(7).value ?? 0) + live.value;
        const Leaf = createLeaf(kind, reader, 'state', stats);

        const result = render(<Leaf testId="leaf" />);
        await expect.element(result.getByTestId('leaf')).toHaveTextContent('7');
        await settle();
        expect(counts.active).toBe(1);

        const before = stats.renders;
        live.value = 1;
        result.unmount();
        await settle();
        await sleep(LEASE_TTL * 2 + 100);

        expect(stats.renders).toBe(before);
        expect(counts.active).toBe(0);
        expect(getRenderLeaseCount()).toBe(0);
      });

      test(`${kind}: StrictMode mount + unmount leaks nothing and keeps one activation`, async () => {
        const { counts, leafRelay } = createRelayHarness();
        const stats = { renders: 0, committed: [] as number[] };
        const reader = () => leafRelay(3).value ?? -1;
        const Leaf = createLeaf(kind, reader, 'state', stats);

        const result = render(
          <StrictMode>
            <Leaf testId="leaf" />
          </StrictMode>,
        );
        await expect.element(result.getByTestId('leaf')).toHaveTextContent('3');
        await settle();
        expect(counts.active).toBe(1);

        result.unmount();
        await settle();
        await sleep(LEASE_TTL * 2 + 100);
        await settle();

        expect(counts.active).toBe(0);
        expect(getRenderLeaseCount()).toBe(0);
      });

      test(`${kind}: leases from an interrupted transition still release`, async () => {
        const { counts, leafRelay } = createRelayHarness();
        const ids = [0, 1, 2, 3, 4];
        const readers = ids.map(id => () => leafRelay(id).value ?? -1);
        let bodyRuns = 0;
        let ticked = false;
        let show: (value: boolean) => void = () => {};
        let urgent: (value: number) => void = () => {};

        const options = { delivery: 'state' as const };
        const onBody = () => {
          bodyRuns++;
          busyWait(8);
          if (!ticked) {
            ticked = true;
            setTimeout(() => urgent(1), 0);
          }
        };

        function ReactiveLeaf({ id }: { id: number }) {
          onBody();
          const value = useReactive(() => readers[id](), options);
          return <span data-testid={`leaf-${id}`}>{value}</span>;
        }

        function ShallowLeaf({ id }: { id: number }) {
          onBody();
          const value = useReactiveShallow(readers[id], options);
          return <span data-testid={`leaf-${id}`}>{value}</span>;
        }

        const ComponentLeaf = component(({ id }: { id: number }) => {
          onBody();
          return <span data-testid={`leaf-${id}`}>{readers[id]()}</span>;
        }, options);

        const Leaf = kind === 'component' ? ComponentLeaf : kind === 'useReactive' ? ReactiveLeaf : ShallowLeaf;

        function Host() {
          const [visible, setVisible] = useState(false);
          const [, setUrgent] = useState(0);
          show = setVisible;
          urgent = v => flushSync(() => setUrgent(v));
          return (
            <div>{visible ? ids.map(id => <Leaf key={id} id={id} />) : <span data-testid="empty">empty</span>}</div>
          );
        }

        const result = render(<Host />);
        await expect.element(result.getByTestId('empty')).toBeInTheDocument();
        startTransition(() => show(true));
        await expect.element(result.getByTestId('leaf-4')).toHaveTextContent('4');
        await settle();

        // React really discarded leaf renders.
        expect(bodyRuns).toBeGreaterThan(ids.length);
        expect(counts.active).toBe(ids.length);
        expect(counts.activations).toBe(ids.length);

        startTransition(() => show(false));
        await expect.element(result.getByTestId('empty')).toBeInTheDocument();
        await sleep(LEASE_TTL * 2 + 100);
        await settle();

        expect(counts.active).toBe(0);
        expect(getRenderLeaseCount()).toBe(0);
        result.unmount();
      });
    }
  });
});
