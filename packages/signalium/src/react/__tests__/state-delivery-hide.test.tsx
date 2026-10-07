import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { Activity, Suspense, startTransition, use, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { reactive, relay, signal } from 'signalium';
import { setConfig } from 'signalium/config';
import { component, useReactive, useReactiveShallow, type ReactDelivery } from 'signalium/react';
import { getRenderLeaseCount } from 'signalium/debug';
import { sleep } from '../../__tests__/utils/async.js';

/**
 * A `'state'` reader subscribes in a layout effect. Hiding a subtree disconnects its layout
 * effects: a Suspense boundary that hides already-revealed content (how react-freeze freezes
 * inactive screens) and `<Activity mode="hidden">` both do, and `<Activity>` also disconnects
 * passive effects. A reader whose dependencies changed while it was hidden must show the current
 * value in the commit that reveals it, without an extra render when nothing changed.
 */

const LEASE_TTL = 150;
const DEFAULT_LEASE_TTL = 10_000;

const settle = () => sleep(50);
const expireLeases = () => sleep(LEASE_TTL * 2 + 100);

type ReaderKind = 'component' | 'useReactive' | 'useReactiveShallow';
const READER_KINDS: ReaderKind[] = ['component', 'useReactive', 'useReactiveShallow'];

type Stats = { renders: number };

function createLeaf(kind: ReaderKind, source: () => number, delivery: ReactDelivery, stats: Stats) {
  const options = { delivery };

  if (kind === 'component') {
    return component(({ testId }: { testId: string }) => {
      stats.renders++;
      return <span data-testid={testId}>{source()}</span>;
    }, options);
  }

  if (kind === 'useReactive') {
    return function Leaf({ testId }: { testId: string }) {
      stats.renders++;
      const value = useReactive(() => source(), options);
      return <span data-testid={testId}>{value}</span>;
    };
  }

  return function Leaf({ testId }: { testId: string }) {
    stats.renders++;
    const value = useReactiveShallow(source, options);
    return <span data-testid={testId}>{value}</span>;
  };
}

/** react-freeze's mechanism: suspend already-revealed content so Suspense hides it in place. */
function Freeze({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Suspender freeze={freeze}>{children}</Suspender>
    </Suspense>
  );
}

function Suspender({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  const cache = useRef<{ promise?: Promise<void>; resolve?: () => void }>({}).current;

  if (freeze) {
    cache.promise ??= new Promise<void>(resolve => (cache.resolve = resolve));
    throw cache.promise;
  }

  if (cache.promise !== undefined) {
    cache.resolve!();
    cache.promise = undefined;
  }

  return <>{children}</>;
}

type HideKind = 'freeze' | 'activity';

// `<Activity>` is React 19.2+.
const HAS_ACTIVITY = Activity !== undefined;
const HIDE_KINDS: HideKind[] = HAS_ACTIVITY ? ['freeze', 'activity'] : ['freeze'];

function Hider({ kind, hidden, children }: { kind: HideKind; hidden: boolean; children: React.ReactNode }) {
  return kind === 'freeze' ? (
    <Freeze freeze={hidden}>{children}</Freeze>
  ) : (
    <Activity mode={hidden ? 'hidden' : 'visible'}>{children}</Activity>
  );
}

function createRelayHarness() {
  const counts = { active: 0, activations: 0 };
  const leafRelay = reactive(() =>
    relay<number>(state => {
      counts.active++;
      counts.activations++;
      state.value = 100;
      return () => {
        counts.active--;
      };
    }),
  );
  return { counts, leafRelay };
}

function mountHidable(kind: ReaderKind, hide: HideKind, delivery: ReactDelivery, source: () => number, stats: Stats) {
  const Leaf = createLeaf(kind, source, delivery, stats);
  // Created once, so hiding and revealing never re-render the leaf from its parent: whatever it
  // shows after the reveal comes from its own delivery.
  const leaf = <Leaf testId="leaf" />;
  let setHidden: (hidden: boolean) => void = () => {};

  function Host() {
    const [hidden, set] = useState(false);
    setHidden = set;
    return (
      <Hider kind={hide} hidden={hidden}>
        {leaf}
      </Hider>
    );
  }

  const result = render(<Host />);
  const text = () => result.container.querySelector('[data-testid="leaf"]')?.textContent;

  return {
    result,
    text,
    hide: () => flushSync(() => setHidden(true)),
    /** Reveals synchronously and returns the text of the first visible commit. */
    reveal: () => {
      flushSync(() => setHidden(false));
      return text();
    },
  };
}

describe('React > state delivery across hide/reveal', () => {
  beforeAll(() => {
    setConfig({ renderLeaseTtl: LEASE_TTL });
  });

  afterAll(() => {
    setConfig({ renderLeaseTtl: DEFAULT_LEASE_TTL });
  });

  afterEach(() => {
    setConfig({ reactDelivery: 'sync' });
  });

  for (const hide of HIDE_KINDS) {
    for (const kind of READER_KINDS) {
      describe(`${hide} > ${kind}`, () => {
        test('a dependency that changed while hidden is current in the revealing commit', async () => {
          const price = signal(1);
          const derived = reactive(() => price.value * 2);
          const stats = { renders: 0 };
          const { result, text, hide: hideIt, reveal } = mountHidable(kind, hide, 'state', derived, stats);

          await expect.element(result.getByTestId('leaf')).toHaveTextContent('2');
          await settle();

          hideIt();
          await settle();
          const hiddenRenders = stats.renders;

          price.value = 2;
          await settle();
          price.value = 3;
          await settle();
          // A hidden reader is not rendered for changes it cannot show.
          expect(stats.renders).toBe(hiddenRenders);

          expect(reveal()).toBe('6');
          await settle();
          expect(text()).toBe('6');
          // One render, before the revealing commit paints.
          expect(stats.renders).toBe(hiddenRenders + 1);

          // Still live after the reveal.
          price.value = 4;
          await expect.element(result.getByTestId('leaf')).toHaveTextContent('8');
          result.unmount();
        });

        test('revealing without changes does not render again', async () => {
          const price = signal(1);
          const derived = reactive(() => price.value * 2);
          const stats = { renders: 0 };
          const { result, hide: hideIt, reveal } = mountHidable(kind, hide, 'state', derived, stats);

          await expect.element(result.getByTestId('leaf')).toHaveTextContent('2');
          await settle();

          const before = stats.renders;
          hideIt();
          await settle();
          expect(reveal()).toBe('2');
          await settle();

          expect(stats.renders).toBe(before);
          result.unmount();
        });

        test('a reveal renders neither the reader nor its parent unless the value changed', async () => {
          const price = signal(1);
          // Re-validating on reveal recomputes this, but an equal result is not a change.
          const derived = reactive(() => Math.abs(price.value) * 2);
          const stats = { renders: 0 };
          const parentStats = { renders: 0 };
          const Leaf = createLeaf(kind, () => derived(), 'state', stats);
          const Parent = component(
            () => {
              parentStats.renders++;
              return <Leaf testId="leaf" />;
            },
            { delivery: 'state' },
          );
          const parent = <Parent />;
          let setHidden: (hidden: boolean) => void = () => {};

          function Host() {
            const [hidden, set] = useState(false);
            setHidden = set;
            return (
              <Hider kind={hide} hidden={hidden}>
                {parent}
              </Hider>
            );
          }

          const result = render(<Host />);
          const text = () => result.container.querySelector('[data-testid="leaf"]')?.textContent;
          await expect.element(result.getByTestId('leaf')).toHaveTextContent('2');
          await settle();

          const flip = async (whileHidden?: () => void) => {
            flushSync(() => setHidden(true));
            await settle();
            whileHidden?.();
            await settle();
            flushSync(() => setHidden(false));
            const firstVisible = text();
            await settle();
            return firstVisible;
          };

          const before = { leaf: stats.renders, parent: parentStats.renders };
          expect(await flip()).toBe('2');
          expect(await flip()).toBe('2');
          expect(await flip(() => (price.value = -1))).toBe('2');
          expect({ leaf: stats.renders, parent: parentStats.renders }).toEqual(before);

          // A real change while hidden: one render of the reader, before the revealing commit paints.
          expect(await flip(() => (price.value = 3))).toBe('6');
          expect({ leaf: stats.renders, parent: parentStats.renders }).toEqual({
            leaf: before.leaf + 1,
            parent: before.parent,
          });

          expect(await flip()).toBe('6');
          expect({ leaf: stats.renders, parent: parentStats.renders }).toEqual({
            leaf: before.leaf + 1,
            parent: before.parent,
          });
          result.unmount();
        });

        test('unmounting while hidden releases relays and leases', async () => {
          const { counts, leafRelay } = createRelayHarness();
          const live = signal(0);
          const stats = { renders: 0 };
          const reader = () => (leafRelay().value ?? 0) + live.value;
          const { result, hide: hideIt } = mountHidable(kind, hide, 'state', reader, stats);

          await expect.element(result.getByTestId('leaf')).toHaveTextContent('100');
          await settle();
          expect(counts.active).toBe(1);

          hideIt();
          await settle();
          live.value = 1;
          await settle();

          result.unmount();
          await settle();
          await expireLeases();
          await settle();

          expect(counts.active).toBe(0);
          expect(getRenderLeaseCount()).toBe(0);
        });
      });
    }
  }

  if (HAS_ACTIVITY) {
    describe('content first rendered inside a hidden <Activity>', () => {
      for (const delivery of ['sync', 'state'] as const) {
        for (const kind of READER_KINDS) {
          test(`${delivery} > ${kind}: the first visible commit shows the current value`, async () => {
            const price = signal(1);
            const derived = reactive(() => price.value * 2);
            const Leaf = createLeaf(kind, () => derived(), delivery, { renders: 0 });
            const leaf = <Leaf testId="leaf" />;
            let setHidden: (hidden: boolean) => void = () => {};

            // Hidden from the start: React prerenders the leaf but mounts none of its effects
            // until the first reveal, so the reveal is the reader's first connect.
            function Host() {
              const [hidden, set] = useState(true);
              setHidden = set;
              return <Activity mode={hidden ? 'hidden' : 'visible'}>{leaf}</Activity>;
            }

            const result = render(<Host />);
            const text = () => result.container.querySelector('[data-testid="leaf"]')?.textContent;
            await settle();
            const prerendered = text();

            price.value = 5;
            await settle();

            flushSync(() => setHidden(false));
            const firstVisible = text();
            await settle();

            expect({ prerendered, firstVisible, later: text() }).toEqual({
              prerendered: '2',
              firstVisible: '10',
              later: '10',
            });
          });
        }
      }
    });
  }

  describe('a reader whose own render suspends', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: recovers when a change no longer needs what it suspended on`, async () => {
        const step = signal(0);
        const read = () => step.value;
        const pending = new Promise<never>(() => {});
        const options = { delivery: 'state' as const };
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const show = (value: number) => <span data-testid="leaf">{value === 1 ? use(pending) : value}</span>;
        const Leaf =
          kind === 'component'
            ? component(() => show(read()), options)
            : kind === 'useReactive'
              ? () => show(useReactive(read, options))
              : () => show(useReactiveShallow(read, options));

        const { getByTestId, getByText } = render(
          <Suspense fallback={<span>loading</span>}>
            <Leaf />
          </Suspense>,
        );
        await expect.element(getByTestId('leaf')).toHaveTextContent('0');

        step.value = 1;
        await expect.element(getByText('loading')).toBeInTheDocument();

        step.value = 2;
        await expect.element(getByTestId('leaf')).toHaveTextContent('2');
      });
    }
  });

  describe('a first mount', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: a change between render and commit is delivered at default priority`, async () => {
        const price = signal(1);
        const derived = reactive(() => price.value * 2);
        const stats = { renders: 0 };
        const Leaf = createLeaf(kind, () => derived(), 'state', stats);

        // Its layout effect runs before the leaf's, so the leaf connects to a value that moved
        // after it rendered, as when data ticks while a screen mounts.
        function Bump() {
          useLayoutEffect(() => {
            price.value = 2;
          }, []);
          return null;
        }

        let show: (visible: boolean) => void = () => {};
        function Host() {
          const [visible, setVisible] = useState(false);
          show = setVisible;
          return visible ? (
            <>
              <Bump />
              <Leaf testId="leaf" />
            </>
          ) : null;
        }

        const result = render(<Host />);
        const text = () => result.container.querySelector('[data-testid="leaf"]')?.textContent;
        await settle();

        flushSync(() => show(true));
        // Not rendered again from the layout effect: the mount commit paints what it rendered.
        expect({ text: text(), renders: stats.renders }).toEqual({ text: '2', renders: 1 });

        await expect.element(result.getByTestId('leaf')).toHaveTextContent('4');
        await settle();
        expect(stats.renders).toBe(2);
        result.unmount();
      });
    }
  });

  describe('relays across a hide', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: a Suspense hide keeps relays alive, like 'sync'`, async () => {
        const { counts, leafRelay } = createRelayHarness();
        const live = signal(0);
        const stats = { renders: 0 };
        const reader = () => (leafRelay().value ?? 0) + live.value;
        const { result, hide: hideIt, reveal } = mountHidable(kind, 'freeze', 'state', reader, stats);

        await expect.element(result.getByTestId('leaf')).toHaveTextContent('100');
        await settle();
        expect(counts.active).toBe(1);

        hideIt();
        await settle();
        await expireLeases();
        expect(counts.active).toBe(1);

        live.value = 5;
        await settle();
        expect(reveal()).toBe('105');
        await settle();

        expect(counts.active).toBe(1);
        expect(counts.activations).toBe(1);
        result.unmount();
        await settle();
        expect(counts.active).toBe(0);
      });

      test.skipIf(!HAS_ACTIVITY)(
        `${kind}: <Activity mode="hidden"> stops relays and restarts them on reveal`,
        async () => {
          const { counts, leafRelay } = createRelayHarness();
          const live = signal(0);
          const stats = { renders: 0 };
          const reader = () => (leafRelay().value ?? 0) + live.value;
          const { result, hide: hideIt, reveal } = mountHidable(kind, 'activity', 'state', reader, stats);

          await expect.element(result.getByTestId('leaf')).toHaveTextContent('100');
          await settle();
          expect(counts.active).toBe(1);

          hideIt();
          await settle();
          await expireLeases();
          expect(counts.active).toBe(0);

          live.value = 5;
          await settle();
          expect(reveal()).toBe('105');
          await settle();

          expect(counts.active).toBe(1);
          expect(counts.activations).toBe(2);
          result.unmount();
          await settle();
          expect(counts.active).toBe(0);
        },
      );
    }
  });

  describe('a render lease released before its commit', () => {
    for (const kind of READER_KINDS) {
      test(`${kind}: a change after the lease expired is delivered once it commits`, async () => {
        const price = signal(1);
        const derived = reactive(() => price.value * 2);
        const stats = { renders: 0 };
        const Leaf = createLeaf(kind, derived, 'state', stats);

        let leafRendered = false;
        function Marker() {
          leafRendered = true;
          return null;
        }

        function Slow({ i }: { i: number }) {
          const end = performance.now() + 5;
          while (performance.now() < end) {
            // time-sliced render work that outlives the lease
          }
          return <span>{i}</span>;
        }

        let show: (value: boolean) => void = () => {};
        function Host() {
          const [visible, setVisible] = useState(false);
          show = setVisible;
          return visible ? (
            <div>
              <Leaf testId="leaf" />
              <Marker />
              {Array.from({ length: 120 }, (_, i) => (
                <Slow key={i} i={i} />
              ))}
            </div>
          ) : (
            <span data-testid="idle">idle</span>
          );
        }

        const result = render(<Host />);
        await expect.element(result.getByTestId('idle')).toBeInTheDocument();

        const leaseTtl = 40;
        // Hold signal flushes, so the subscription's own scheduled pull cannot paper over a missed
        // change: only the pull at subscribe can see it.
        const held: (() => void)[] = [];
        setConfig({ renderLeaseTtl: leaseTtl, scheduleFlush: fn => void held.push(fn) });
        try {
          startTransition(() => show(true));
          while (!leafRendered) await sleep(1);
          // Past the lease's maximum lifetime, while the transition is still rendering.
          await sleep(leaseTtl * 2 + 30);
          expect(result.container.querySelector('[data-testid="leaf"]')).toBeNull();
          price.value = 3;

          await expect.element(result.getByTestId('leaf')).toHaveTextContent('6');
        } finally {
          setConfig({ renderLeaseTtl: LEASE_TTL, scheduleFlush: fn => void setTimeout(fn, 0) });
          for (const fn of held) fn();
        }
        await settle();
        result.unmount();
      });
    }
  });
});
