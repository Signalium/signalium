import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal } from 'signalium';
import { useReactive, useReactiveDeep } from 'signalium/react';
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
});

describe('React > useReactiveDeep thunk form', () => {
  test('returns a structurally-shared snapshot and updates on change', async () => {
    const a = signal(1);
    const b = signal('hello');

    const snapshots: unknown[] = [];

    function Component(): React.ReactNode {
      const result = useReactiveDeep(() => ({ a: a.value, b: b.value }));
      snapshots.push(result);
      return <div data-testid="out">{JSON.stringify(result)}</div>;
    }

    const { getByTestId } = render(<Component />);

    await expect.element(getByTestId('out')).toHaveTextContent('{"a":1,"b":"hello"}');

    // Set to same values: snapshot reference should be preserved.
    a.value = 1;
    b.value = 'hello';
    await Promise.resolve();

    const beforeChange = snapshots[snapshots.length - 1];

    a.value = 2;
    await expect.element(getByTestId('out')).toHaveTextContent('{"a":2,"b":"hello"}');

    const afterChange = snapshots[snapshots.length - 1];
    expect(afterChange).not.toBe(beforeChange);
  });

  test('recomputes when captured props change', async () => {
    const source = signal(10);

    function Inner({ multiplier }: { multiplier: number }): React.ReactNode {
      const result = useReactiveDeep(() => ({ value: source.value * multiplier }));
      return <div data-testid="out">{result.value}</div>;
    }

    function Parent(): React.ReactNode {
      const [m, setM] = useState(2);
      return (
        <>
          <Inner multiplier={m} />
          <button onClick={() => setM(3)}>Bump</button>
        </>
      );
    }

    const { getByTestId, getByText } = render(<Parent />);

    await expect.element(getByTestId('out')).toHaveTextContent('20');

    source.value = 5;
    await expect.element(getByTestId('out')).toHaveTextContent('10');

    await userEvent.click(getByText('Bump'));
    await expect.element(getByTestId('out')).toHaveTextContent('15');
  });
});
