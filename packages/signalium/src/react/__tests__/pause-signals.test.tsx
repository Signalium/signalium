import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, relay } from 'signalium';
import { useReactive, PauseSignalsProvider } from 'signalium/react';
import React, { useState } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';
import { createRenderCounter } from './utils.js';
import component from '../component.js';

describe('React > Pause Signals', () => {
  test('basic pausing - signals do not trigger re-renders when paused', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      return <div>{useReactive(() => text.value)}</div>;
    }

    const { getByText } = render(
      <PauseSignalsProvider value={true}>
        <Component />
      </PauseSignalsProvider>,
    );

    await expect.element(getByText('Hello')).toBeInTheDocument();

    // Update signal - should NOT trigger re-render when suspended
    text.value = 'World';

    // Should still show old value (not "World")
    await expect.element(getByText('Hello')).toBeInTheDocument();
  });

  test('re-enabling - signals resume updates when context changes back to enabled', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      const [suspended, setDisabled] = useState(false);

      return (
        <div>
          <PauseSignalsProvider value={suspended}>
            <div data-testid="content">{useReactive(() => text.value)}</div>
          </PauseSignalsProvider>
          <button onClick={() => setDisabled(!suspended)}>Toggle Disabled</button>
        </div>
      );
    }

    const { getByText, getByTestId } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    // Update signal - should trigger re-render when enabled
    text.value = 'World';
    await expect.element(getByText('World')).toBeInTheDocument();

    // Disable signals
    await userEvent.click(getByText('Toggle Disabled'));

    // Update signal - should NOT trigger re-render when suspended
    text.value = 'Disabled';
    await expect.element(getByTestId('content')).toHaveTextContent('World');

    // Re-enable signals
    await userEvent.click(getByText('Toggle Disabled'));

    // Should now show the latest value
    await expect.element(getByTestId('content')).toHaveTextContent('Disabled');

    // And updates should work again
    text.value = 'Re-enabled';
    await expect.element(getByTestId('content')).toHaveTextContent('Re-enabled');
  });

  test('nested contexts - inner context can override outer context', async () => {
    const text = signal('Hello');

    function Inner(): React.ReactNode {
      return <div data-testid="inner">{useReactive(() => text.value)}</div>;
    }

    function Outer(): React.ReactNode {
      return <div data-testid="outer">{useReactive(() => text.value)}</div>;
    }

    const { getByTestId } = render(
      <PauseSignalsProvider value={true}>
        <Outer />
        <PauseSignalsProvider value={false}>
          <Inner />
        </PauseSignalsProvider>
      </PauseSignalsProvider>,
    );

    await expect.element(getByTestId('outer')).toHaveTextContent('Hello');
    await expect.element(getByTestId('inner')).toHaveTextContent('Hello');

    // Update signal
    text.value = 'World';

    // Outer should NOT update (suspended)
    await expect.element(getByTestId('outer')).toHaveTextContent('Hello');

    // Inner should update (enabled via nested context)
    await expect.element(getByTestId('inner')).toHaveTextContent('World');
  });

  test('component function respects paused context', async () => {
    const text = signal('Hello');

    const Component = component(() => <div>{text.value}</div>);

    const { getByText } = render(
      <PauseSignalsProvider value={true}>
        <Component />
      </PauseSignalsProvider>,
    );

    await expect.element(getByText('Hello')).toBeInTheDocument();

    // Update signal - should NOT trigger re-render
    text.value = 'World';
    await expect.element(getByText('Hello')).toBeInTheDocument();
  });

  test('useReactive with signals respects paused context', async () => {
    const count = signal(0);

    function Component(): React.ReactNode {
      return <div>{useReactive(() => count.value)}</div>;
    }

    const { getByText } = render(
      <PauseSignalsProvider value={true}>
        <Component />
      </PauseSignalsProvider>,
    );

    await expect.element(getByText('0')).toBeInTheDocument();

    count.value = 1;
    await expect.element(getByText('0')).toBeInTheDocument();

    count.value = 2;
    await expect.element(getByText('0')).toBeInTheDocument();
  });

  test('useReactive with reactive functions respects paused context', async () => {
    const text = signal('Hello');
    const derived = reactive(() => `${text.value}, World`);

    function Component(): React.ReactNode {
      return <div>{useReactive(() => derived())}</div>;
    }

    const { getByText } = render(
      <PauseSignalsProvider value={true}>
        <Component />
      </PauseSignalsProvider>,
    );

    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    text.value = 'Hey';
    await expect.element(getByText('Hello, World')).toBeInTheDocument();
  });

  test('value retention - paused signals maintain their last value', async () => {
    const count = signal(0);

    function Component(): React.ReactNode {
      const [suspended, setDisabled] = useState(false);

      return (
        <div>
          <PauseSignalsProvider value={suspended}>
            <div data-testid="count">{useReactive(() => count.value)}</div>
          </PauseSignalsProvider>
          <button onClick={() => setDisabled(!suspended)}>Toggle</button>
        </div>
      );
    }

    const { getByText, getByTestId } = render(<Component />);

    await expect.element(getByTestId('count')).toHaveTextContent('0');

    count.value = 1;
    await expect.element(getByTestId('count')).toHaveTextContent('1');

    count.value = 2;
    await expect.element(getByTestId('count')).toHaveTextContent('2');

    // Disable
    await userEvent.click(getByText('Toggle'));

    // Value should remain at last known value
    await expect.element(getByTestId('count')).toHaveTextContent('2');

    // Even after multiple updates
    count.value = 3;
    count.value = 4;
    count.value = 5;
    await expect.element(getByTestId('count')).toHaveTextContent('2');

    // Re-enable - should jump to current value
    await userEvent.click(getByText('Toggle'));
    await expect.element(getByTestId('count')).toHaveTextContent('5');
  });

  test('reactive promises respect paused context', async () => {
    const value = signal('Hello');

    const derived = reactive(async () => {
      const v = value.value;
      await sleep(50);
      return `${v}, World`;
    });

    const Component = component(({ suspended }: { suspended: boolean }) => {
      return (
        <PauseSignalsProvider value={suspended}>
          <Inner />
        </PauseSignalsProvider>
      );
    });

    const Inner = component(() => {
      const d = derived();
      return <div>{d.isPending ? 'Loading...' : d.value}</div>;
    });

    const Wrapper = () => {
      const [suspended, setDisabled] = useState(false);
      return (
        <div>
          <Component suspended={suspended} />
          <button onClick={() => setDisabled(!suspended)}>Toggle</button>
        </div>
      );
    };

    const { getByText } = render(<Wrapper />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    // Disable
    await userEvent.click(getByText('Toggle'));

    // Update should not trigger re-render
    value.value = 'Hey';

    // Wait for what would have been the update
    await sleep(100);

    // Should still show old value
    await expect.element(getByText('Hello, World')).toBeInTheDocument();
  });

  test('relays respect paused context', async () => {
    const content = signal('World');

    const derived = reactive(() => {
      return relay<string>(state => {
        const v = content.value;
        const run = async () => {
          await sleep(50);
          return `Hello, ${v}`;
        };

        state.setPromise(run());
      });
    });

    const Inner = component(() => {
      const d = derived();
      return <div>{d.isPending ? 'Loading...' : d.value}</div>;
    });

    const Wrapper = () => {
      const [suspended, setDisabled] = useState(false);
      return (
        <div>
          <PauseSignalsProvider value={suspended}>
            <Inner />
            <button onClick={() => setDisabled(!suspended)}>Toggle</button>
          </PauseSignalsProvider>
        </div>
      );
    };

    const { getByText } = render(<Wrapper />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    // Disable
    await userEvent.click(getByText('Toggle'));

    // Update should not trigger re-render
    content.value = 'Universe';

    // Wait for what would have been the update
    await sleep(100);

    // Should still show old value
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    // Re-enable
    await userEvent.click(getByText('Toggle'));
    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();
  });

  test('multiple components with different paused states', async () => {
    const count = signal(0);

    const ComponentA = () => <div data-testid="a">{useReactive(() => count.value)}</div>;
    const ComponentB = () => <div data-testid="b">{useReactive(() => count.value)}</div>;
    const ComponentC = () => <div data-testid="c">{useReactive(() => count.value)}</div>;

    const { getByTestId } = render(
      <div>
        <PauseSignalsProvider value={true}>
          <ComponentA />
        </PauseSignalsProvider>
        <PauseSignalsProvider value={false}>
          <ComponentB />
        </PauseSignalsProvider>
        <ComponentC />
      </div>,
    );

    await expect.element(getByTestId('a')).toHaveTextContent('0');
    await expect.element(getByTestId('b')).toHaveTextContent('0');
    await expect.element(getByTestId('c')).toHaveTextContent('0');

    count.value = 1;

    // A should not update (suspended)
    await expect.element(getByTestId('a')).toHaveTextContent('0');
    // B should update (explicitly enabled)
    await expect.element(getByTestId('b')).toHaveTextContent('1');
    // C should update (default enabled)
    await expect.element(getByTestId('c')).toHaveTextContent('1');
  });

  test('pausing does not prevent new subscriptions', async () => {
    const count = signal(0);

    const Child = () => <div data-testid="content">{useReactive(() => count.value)}</div>;

    const Component = () => {
      const [show, setShow] = useState(false);

      return (
        <PauseSignalsProvider value={true}>
          <div>
            {show && <Child />}
            <button onClick={() => setShow(true)}>Show</button>
          </div>
        </PauseSignalsProvider>
      );
    };

    const { getByText, getByTestId } = render(<Component />);

    // Show the component
    await userEvent.click(getByText('Show'));

    // Should show current value even though suspended
    await expect.element(getByTestId('content')).toHaveTextContent('0');

    // Updates should still not work
    count.value = 1;
    await expect.element(getByTestId('content')).toHaveTextContent('0');
  });

  test('relay is not activated when component mounts inside an already-paused provider', async () => {
    let relayActivateCount = 0;

    const derived = reactive(() => {
      return relay<string>(state => {
        relayActivateCount++;
        state.value = 'activated';
      });
    });

    function Inner(): React.ReactNode {
      const d = useReactive(() => derived());
      return <div data-testid="content">{d.isPending ? 'pending' : d.value}</div>;
    }

    function Wrapper(): React.ReactNode {
      const [show, setShow] = useState(false);

      return (
        <PauseSignalsProvider value={true}>
          {show && <Inner />}
          <button onClick={() => setShow(true)}>Mount</button>
        </PauseSignalsProvider>
      );
    }

    const { getByText, getByTestId } = render(<Wrapper />);

    // Mount the component inside the already-suspended provider
    await userEvent.click(getByText('Mount'));

    // The component renders with the initial value, but the relay
    // should NOT have been activated since the provider is suspended.
    await sleep(50);
    expect(relayActivateCount).toBe(0);
    await expect.element(getByTestId('content')).toHaveTextContent('pending');
  });

  test('toggling pause does not cause re-renders when signals have not changed', async () => {
    const count = signal(0);
    const Child = createRenderCounter(() => <div data-testid="content">{useReactive(() => count.value)}</div>);
    const MemoChild = React.memo(Child);

    function Wrapper(): React.ReactNode {
      const [suspended, setSuspended] = useState(false);

      return (
        <div>
          <PauseSignalsProvider value={suspended}>
            <MemoChild />
          </PauseSignalsProvider>
          <button onClick={() => setSuspended(s => !s)}>Toggle</button>
        </div>
      );
    }

    const { getByText, getByTestId } = render(<Wrapper />);

    await expect.element(getByTestId('content')).toHaveTextContent('0');
    const afterMount = Child.renderCount;

    // Suspend
    await userEvent.click(getByText('Toggle'));
    await sleep(50);

    // Resume — signal hasn't changed and the child is memoized, so
    // the context change is fully absorbed by the provider. Zero
    // extra renders on the child.
    await userEvent.click(getByText('Toggle'));
    await sleep(50);

    expect(Child.renderCount).toBe(afterMount);
    await expect.element(getByTestId('content')).toHaveTextContent('0');
  });

  test('render count is not affected when signals update while paused', async () => {
    const count = signal(0);
    const Child = createRenderCounter(() => <div>{useReactive(() => count.value)}</div>);

    const Component = () => {
      return (
        <PauseSignalsProvider value={true}>
          <Child />
        </PauseSignalsProvider>
      );
    };

    const { getByTestId } = render(<Component />);

    expect(getByTestId(String(Child.testId))).toBeDefined();
    const initialRenderCount = Child.renderCount;

    // Update signal multiple times
    count.value = 1;
    count.value = 2;
    count.value = 3;

    // Wait a bit to ensure no renders happened
    await sleep(50);

    // Render count should not have changed
    expect(Child.renderCount).toBe(initialRenderCount);
  });
});
