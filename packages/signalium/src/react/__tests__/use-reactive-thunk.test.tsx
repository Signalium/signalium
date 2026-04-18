import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive } from 'signalium';
import { useReactive, useReactiveShallow } from 'signalium/react';
import React, { useState } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';
import { createRenderCounter } from './utils.js';

describe('React > useReactive thunk form', () => {
  test('reads a signal value and updates when it changes', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      return <div>{useReactive(() => text.value)}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';

    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('reruns when captured props change', async () => {
    const text = signal('Hello');

    function Inner({ suffix }: { suffix: string }): React.ReactNode {
      return <div>{useReactive(() => `${text.value} ${suffix}`)}</div>;
    }

    function Parent(): React.ReactNode {
      const [suffix, setSuffix] = useState('World');
      return (
        <>
          <Inner suffix={suffix} />
          <button onClick={() => setSuffix('Universe')}>Toggle</button>
        </>
      );
    }

    const { getByText } = render(<Parent />);

    await expect.element(getByText('Hello World')).toBeInTheDocument();

    text.value = 'Hey';
    await expect.element(getByText('Hey World')).toBeInTheDocument();

    await userEvent.click(getByText('Toggle'));
    await expect.element(getByText('Hey Universe')).toBeInTheDocument();
  });

  test('does not rerender on ancestor rerenders when captures are equal', async () => {
    const text = signal('Hello');

    const Inner = createRenderCounter(({ suffix }: { suffix: string }) => {
      return <span>{useReactive(() => `${text.value} ${suffix}`)}</span>;
    });

    function Parent(): React.ReactNode {
      const [, setTick] = useState(0);
      return (
        <div>
          <Inner suffix="World" />
          <button onClick={() => setTick(t => t + 1)}>Tick</button>
        </div>
      );
    }

    const { getByText } = render(<Parent />);
    await expect.element(getByText('Hello World')).toBeInTheDocument();

    const initialCount = Inner.renderCount;

    await userEvent.click(getByText('Tick'));
    await userEvent.click(getByText('Tick'));
    await userEvent.click(getByText('Tick'));

    // `suffix` did not change, so the thunk keeps a stable identity and the
    // signal is not recreated. The component still rerenders due to parent
    // state, but the value reads remain stable.
    await expect.element(getByText('Hello World')).toBeInTheDocument();
    expect(Inner.renderCount).toBe(initialCount + 3);
  });

  test('thunk compute is memoized across unrelated rerenders and unrelated state changes', async () => {
    // Module-stable refs so the transform captures them by identity (the dep
    // array stays equal across renders). A bare `let computeCount = 0` would
    // show up as a dep whose VALUE changes on each compute, breaking useCallback.
    const tracked = signal(1);
    const unrelated = signal('x');
    const counter = { n: 0 };

    function Component(): React.ReactNode {
      const [, setTick] = useState(0);

      const value = useReactive(() => {
        counter.n++;
        return tracked.value * 10;
      });
      // Separate useReactive subscribes to `unrelated` so the component
      // rerenders when it changes, but `unrelated` is NOT captured by the
      // first thunk — if memoization works, its compute must stay cached.
      const u = useReactive(() => unrelated.value);

      return (
        <div>
          <span data-testid="out">{value}</span>
          <span data-testid="u">{u}</span>
          <button onClick={() => setTick(t => t + 1)}>Tick</button>
        </div>
      );
    }

    const { getByTestId, getByText } = render(<Component />);

    await expect.element(getByTestId('out')).toHaveTextContent('10');
    expect(counter.n).toBe(1);

    // Parent-driven rerender with no dep change — the signal is clean, so compute must not run.
    await userEvent.click(getByText('Tick'));
    await userEvent.click(getByText('Tick'));
    await expect.element(getByTestId('out')).toHaveTextContent('10');
    expect(counter.n).toBe(1);

    // Unrelated signal change causes a rerender but the thunk must not recompute.
    unrelated.value = 'y';
    await expect.element(getByTestId('u')).toHaveTextContent('y');
    expect(counter.n).toBe(1);

    // Tracked signal change DOES recompute.
    tracked.value = 2;
    await expect.element(getByTestId('out')).toHaveTextContent('20');
    expect(counter.n).toBe(2);

    // Another unrelated bump — still cached at 2.
    unrelated.value = 'z';
    await expect.element(getByTestId('u')).toHaveTextContent('z');
    expect(counter.n).toBe(2);
  });

  test('supports async thunks (returns a ReactivePromise)', async () => {
    const value = signal('Hello');

    function Component(): React.ReactNode {
      const d = useReactive(async () => {
        const v = value.value;
        await sleep(50);
        return `${v}, World`;
      });
      return <div>{d.isPending ? 'Loading...' : d.value}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    value.value = 'Hey';
    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  describe('rules of use', () => {
    // The Babel preset wraps inline thunks passed to `useReactive` /
    // `useReactiveShallow` in `useCallback`, which is itself a React hook. To
    // exercise the runtime guard without tripping that wrap, we define the
    // thunk outside the tracked call so the transform leaves it alone.
    const alwaysOne = () => 1;

    test('useReactive throws when called inside a reactive function', () => {
      const derived = reactive(() => useReactive(alwaysOne));

      expect(() => derived()).toThrow(/cannot be called inside a reactive function/);
    });

    test('useReactiveShallow throws when called inside a reactive function', () => {
      const derived = reactive(() => useReactiveShallow(alwaysOne));

      expect(() => derived()).toThrow(/cannot be called inside a reactive function/);
    });
  });
});
