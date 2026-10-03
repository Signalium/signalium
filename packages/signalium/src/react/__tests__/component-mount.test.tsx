import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { startTransition, StrictMode, Suspense, useState } from 'react';
import { reactive, relay, signal } from 'signalium';
import { component, PauseSignalsProvider, useReactive } from 'signalium/react';
import { sleep } from '../../__tests__/utils/async.js';

const LEAF_COUNT = 5;
const LEAF_IDS = [0, 1, 2, 3, 4];

/**
 * Builds a per-test harness: a keyed relay that tracks how many instances are currently active,
 * plus a counter for component body executions.
 */
function createHarness() {
  const counts = { bodyRuns: 0, activeRelays: 0, activations: 0 };

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

// Lets scheduled deactivations (and any pending pulls) flush.
const settle = () => sleep(50);

describe('React > component() mount', () => {
  describe('sync component()', () => {
    function setup() {
      const harness = createHarness();
      const Leaf = component(({ id }: { id: number }) => {
        harness.counts.bodyRuns++;
        return <span data-testid={`leaf-${id}`}>{harness.leafRelay(id).value}</span>;
      });
      return { ...harness, Leaf };
    }

    test('renders each body once on a synchronous mount', async () => {
      const { counts, Leaf } = setup();

      const { getByTestId, unmount } = render(
        <div>
          {LEAF_IDS.map(id => (
            <Leaf key={id} id={id} />
          ))}
        </div>,
      );

      await expect.element(getByTestId('leaf-4')).toHaveTextContent('4');
      await settle();

      expect(counts.bodyRuns).toBe(LEAF_COUNT);
      expect(counts.activeRelays).toBe(LEAF_COUNT);

      unmount();
      await settle();

      expect(counts.activeRelays).toBe(0);
    });

    test('renders each body once when mounted inside a transition and leaks no relays', async () => {
      const { counts, Leaf } = setup();
      let show: (value: boolean) => void = () => {};

      function Host() {
        const [visible, setVisible] = useState(false);
        show = setVisible;
        return (
          <div data-testid="host">
            {visible ? LEAF_IDS.map(id => <Leaf key={id} id={id} />) : <span data-testid="empty">empty</span>}
          </div>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('empty')).toBeInTheDocument();

      startTransition(() => show(true));

      await expect.element(getByTestId('leaf-4')).toHaveTextContent('4');
      await settle();

      expect(counts.bodyRuns).toBe(LEAF_COUNT);
      expect(counts.activations).toBe(LEAF_COUNT);
      expect(counts.activeRelays).toBe(LEAF_COUNT);

      startTransition(() => show(false));

      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();

      expect(counts.activeRelays).toBe(0);
    });

    test('still re-renders once per update after mount', async () => {
      const harness = createHarness();
      const text = signal('a');
      const Leaf = component(() => {
        harness.counts.bodyRuns++;
        return <span data-testid="leaf">{text.value}</span>;
      });

      const { getByTestId } = render(<Leaf />);
      await expect.element(getByTestId('leaf')).toHaveTextContent('a');
      await settle();
      expect(harness.counts.bodyRuns).toBe(1);

      text.value = 'b';
      await expect.element(getByTestId('leaf')).toHaveTextContent('b');
      await settle();
      expect(harness.counts.bodyRuns).toBe(2);

      text.value = 'c';
      await expect.element(getByTestId('leaf')).toHaveTextContent('c');
      await settle();
      expect(harness.counts.bodyRuns).toBe(3);
    });

    test('picks up a change made between render and subscription', async () => {
      const text = signal('a');
      let writeDuringLayout = true;

      const Leaf = component(() => <span data-testid="leaf">{text.value}</span>);

      function Writer() {
        React.useLayoutEffect(() => {
          if (writeDuringLayout) {
            writeDuringLayout = false;
            text.value = 'b';
          }
        }, []);
        return null;
      }

      const { getByTestId } = render(
        <>
          <Leaf />
          <Writer />
        </>,
      );

      await expect.element(getByTestId('leaf')).toHaveTextContent('b');
    });

    test('lazily initializing a signal during the mount render keeps the subscription', async () => {
      const value = signal(0);
      const Leaf = component(() => {
        if (value.value === 0) {
          value.value = 1;
        }
        return <span data-testid="leaf">{value.value}</span>;
      });

      const { getByTestId } = render(<Leaf />);
      await expect.element(getByTestId('leaf')).toHaveTextContent('1');

      value.value = 2;
      await expect.element(getByTestId('leaf')).toHaveTextContent('2');
    });

    test('a StrictMode mount stays registered with the pause manager', async () => {
      const harness = createHarness();
      const Leaf = component(({ id }: { id: number }) => (
        <span data-testid={`leaf-${id}`}>{harness.leafRelay(id).value}</span>
      ));

      let setPaused: (value: boolean) => void = () => {};

      function Host() {
        const [paused, _setPaused] = useState(false);
        setPaused = _setPaused;
        return (
          <PauseSignalsProvider value={paused}>
            <Leaf id={1} />
          </PauseSignalsProvider>
        );
      }

      const { getByTestId, unmount } = render(
        <StrictMode>
          <Host />
        </StrictMode>,
      );

      await expect.element(getByTestId('leaf-1')).toHaveTextContent('1');
      await settle();
      expect(harness.counts.activeRelays).toBe(1);

      React.act(() => setPaused(true));
      await settle();
      expect(harness.counts.activeRelays).toBe(0);

      React.act(() => setPaused(false));
      await settle();
      expect(harness.counts.activeRelays).toBe(1);

      unmount();
      await settle();
      expect(harness.counts.activeRelays).toBe(0);
    });
  });

  describe('async component()', () => {
    function setup() {
      const harness = createHarness();
      const Leaf = component(async ({ id }: { id: number }) => {
        harness.counts.bodyRuns++;
        return <span data-testid={`leaf-${id}`}>{harness.leafRelay(id).value}</span>;
      });
      return { ...harness, Leaf };
    }

    test('renders each body once on a synchronous mount', async () => {
      const { counts, Leaf } = setup();

      const { getByTestId, unmount } = render(
        <Suspense fallback={null}>
          {LEAF_IDS.map(id => (
            <Leaf key={id} id={id} />
          ))}
        </Suspense>,
      );

      await expect.element(getByTestId('leaf-4')).toHaveTextContent('4');
      await settle();

      expect(counts.bodyRuns).toBe(LEAF_COUNT);
      expect(counts.activeRelays).toBe(LEAF_COUNT);

      unmount();
      await settle();

      expect(counts.activeRelays).toBe(0);
    });

    test('renders each body once when mounted inside a transition and leaks no relays', async () => {
      const { counts, Leaf } = setup();
      let show: (value: boolean) => void = () => {};

      function Host() {
        const [visible, setVisible] = useState(false);
        show = setVisible;
        return (
          <Suspense fallback={null}>
            {visible ? LEAF_IDS.map(id => <Leaf key={id} id={id} />) : <span data-testid="empty">empty</span>}
          </Suspense>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('empty')).toBeInTheDocument();

      startTransition(() => show(true));

      await expect.element(getByTestId('leaf-4')).toHaveTextContent('4');
      await settle();

      expect(counts.bodyRuns).toBe(LEAF_COUNT);
      expect(counts.activations).toBe(LEAF_COUNT);
      expect(counts.activeRelays).toBe(LEAF_COUNT);

      startTransition(() => show(false));

      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();

      expect(counts.activeRelays).toBe(0);
    });
  });

  describe('useReactive() control', () => {
    test('renders each body once when mounted inside a transition and leaks no relays', async () => {
      const { counts, leafRelay } = createHarness();
      let show: (value: boolean) => void = () => {};

      function Leaf({ id }: { id: number }) {
        counts.bodyRuns++;
        const value = useReactive(() => leafRelay(id).value);
        return <span data-testid={`leaf-${id}`}>{value}</span>;
      }

      function Host() {
        const [visible, setVisible] = useState(false);
        show = setVisible;
        return (
          <div>{visible ? LEAF_IDS.map(id => <Leaf key={id} id={id} />) : <span data-testid="empty">empty</span>}</div>
        );
      }

      const { getByTestId } = render(<Host />);
      await expect.element(getByTestId('empty')).toBeInTheDocument();

      startTransition(() => show(true));

      await expect.element(getByTestId('leaf-4')).toHaveTextContent('4');
      await settle();

      expect(counts.bodyRuns).toBe(LEAF_COUNT);
      expect(counts.activeRelays).toBe(LEAF_COUNT);

      startTransition(() => show(false));
      await expect.element(getByTestId('empty')).toBeInTheDocument();
      await settle();

      expect(counts.activeRelays).toBe(0);
    });
  });
});
