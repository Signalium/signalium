import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, relay } from 'signalium';
import { useReactive, SuspendSignalsProvider } from '../index.js';
import React, { useState } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';
import { createRenderCounter } from './utils.js';
import component from '../component.js';

describe('React > Suspend Signals > Value Preservation', () => {
  test('async reactive value is preserved across suspend/resume cycle', async () => {
    const input = signal('Hello');

    const derived = reactive(async () => {
      const v = input.value;
      await sleep(50);
      return `${v}, World`;
    });

    /**
     * Renders the resolved value of an async reactive, or "Loading..." while pending.
     * Tracks whether the value was ever lost (went back to pending/undefined) after
     * initially resolving — this is the bug we're testing.
     */
    let valueLostAfterResolve = false;
    let hasResolved = false;

    function Inner(): React.ReactNode {
      const d = useReactive(derived);

      if (d.isResolved && d.value !== undefined) {
        hasResolved = true;
      }

      // Detect if value is lost after initial resolution
      if (hasResolved && d.isPending && d.value === undefined) {
        valueLostAfterResolve = true;
      }

      return <div data-testid="content">{d.isPending && !d.value ? 'Loading...' : d.value}</div>;
    }

    function Wrapper(): React.ReactNode {
      const [suspended, setSuspended] = useState(false);

      return (
        <div>
          <SuspendSignalsProvider value={suspended}>
            <Inner />
          </SuspendSignalsProvider>
          <button onClick={() => setSuspended(s => !s)}>Toggle</button>
        </div>
      );
    }

    const { getByText, getByTestId } = render(<Wrapper />);

    // Wait for initial async resolution
    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');

    // Suspend signals (simulate tab blur)
    await userEvent.click(getByText('Toggle'));
    await sleep(50);

    // Value should still be visible while suspended
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');

    // Resume signals (simulate tab focus)
    await userEvent.click(getByText('Toggle'));

    // BUG: After resuming, the value should still be "Hello, World" immediately.
    // Instead, the signal goes through a pending state with undefined value because
    // unwatchSignal destroys the ReactivePromise's resolved state.
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');
    expect(valueLostAfterResolve).toBe(false);
  });

  test('relay value is preserved across suspend/resume cycle', async () => {
    const input = signal('Hello');

    const derived = reactive(() => {
      return relay<string>(state => {
        const v = input.value;
        const run = async () => {
          await sleep(50);
          return `${v}, World`;
        };

        state.setPromise(run());
      });
    });

    /**
     * Same as above, but for relay-based async values.
     * Tests that relay deactivation/reactivation during suspension
     * does not cause the resolved value to be lost.
     */
    let valueLostAfterResolve = false;
    let hasResolved = false;

    function Inner(): React.ReactNode {
      const d = useReactive(derived);

      if (d.isResolved && d.value !== undefined) {
        hasResolved = true;
      }

      if (hasResolved && d.isPending && d.value === undefined) {
        valueLostAfterResolve = true;
      }

      return <div data-testid="content">{d.isPending && !d.value ? 'Loading...' : d.value}</div>;
    }

    function Wrapper(): React.ReactNode {
      const [suspended, setSuspended] = useState(false);

      return (
        <div>
          <SuspendSignalsProvider value={suspended}>
            <Inner />
          </SuspendSignalsProvider>
          <button onClick={() => setSuspended(s => !s)}>Toggle</button>
        </div>
      );
    }

    const { getByText, getByTestId } = render(<Wrapper />);

    // Wait for initial resolution
    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');

    // Suspend signals
    await userEvent.click(getByText('Toggle'));
    await sleep(50);

    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');

    // Resume signals
    await userEvent.click(getByText('Toggle'));

    // Value should be preserved — no pending flash
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');
    expect(valueLostAfterResolve).toBe(false);
  });

  test('rapid suspend/resume cycles do not cause value loss', async () => {
    const input = signal('Hello');

    const derived = reactive(async () => {
      const v = input.value;
      await sleep(50);
      return `${v}, World`;
    });

    let valueLostCount = 0;
    let hasResolved = false;

    function Inner(): React.ReactNode {
      const d = useReactive(derived);

      if (d.isResolved && d.value !== undefined) {
        hasResolved = true;
      }

      if (hasResolved && d.isPending && d.value === undefined) {
        valueLostCount++;
      }

      return <div data-testid="content">{d.isPending && !d.value ? 'Loading...' : d.value}</div>;
    }

    function Wrapper(): React.ReactNode {
      const [suspended, setSuspended] = useState(false);

      return (
        <div>
          <SuspendSignalsProvider value={suspended}>
            <Inner />
          </SuspendSignalsProvider>
          <button data-testid="toggle" onClick={() => setSuspended(s => !s)}>
            Toggle
          </button>
        </div>
      );
    }

    const { getByTestId } = render(<Wrapper />);

    // Wait for initial resolution
    await expect.element(getByTestId('content')).toHaveTextContent('Loading...');
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');

    // Rapidly toggle suspend/resume 5 times (simulating quick tab switches)
    for (let i = 0; i < 5; i++) {
      await userEvent.click(getByTestId('toggle')); // suspend
      await sleep(10);
      await userEvent.click(getByTestId('toggle')); // resume
      await sleep(10);
    }

    // After all cycles, value should still be present
    await expect.element(getByTestId('content')).toHaveTextContent('Hello, World');
    expect(valueLostCount).toBe(0);
  });
});
