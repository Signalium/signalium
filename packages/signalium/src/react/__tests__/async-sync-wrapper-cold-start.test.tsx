import { userEvent } from '@vitest/browser/context';
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { reactive } from 'signalium';
import { render } from 'vitest-browser-react';
import { describe, expect, test } from 'vitest';
import { sleep } from '../../__tests__/utils/async.js';
import { ContextProvider, SuspendSignalsProvider, useReactive } from '../index.js';

/**
 * Creates a deferred promise that can be resolved from the test body.
 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve,
  };
}

/**
 * Creates the minimal sync-wrapper-over-async chain that reproduces the bug.
 */
function createWrappedChain() {
  const deferred = createDeferred<string>();

  const getAsyncValue = reactive(async () => {
    return await deferred.promise;
  });

  const getWrappedValue = reactive(() => {
    const promise = getAsyncValue();

    return promise.isPending ? 'pending' : promise.value;
  });

  const getChildValue = reactive(() => {
    return getWrappedValue();
  });

  return {
    getWrappedValue,
    getChildValue,
    resolve: deferred.resolve,
  };
}

/**
 * Creates the direct async control for the same lifecycle.
 */
function createDirectChain() {
  const deferred = createDeferred<string>();

  const getAsyncValue = reactive(async () => {
    return await deferred.promise;
  });

  const getChildValue = reactive(() => {
    const promise = getAsyncValue();

    return promise.value ?? 'pending';
  });

  return {
    getAsyncValue,
    getChildValue,
    resolve: deferred.resolve,
  };
}

/**
 * Switches from a child consumer to a direct consumer inside one stable scope.
 */
function createWrappedApp({ getWrappedValue, getChildValue }: ReturnType<typeof createWrappedChain>) {
  function ChildConsumer(): React.ReactNode {
    return <div data-testid="wrapped-value">{useReactive(getChildValue)}</div>;
  }

  function DirectConsumer(): React.ReactNode {
    return <div data-testid="wrapped-value">{useReactive(getWrappedValue)}</div>;
  }

  return function App(): React.ReactNode {
    const [phase, setPhase] = useState<'child' | 'none' | 'direct'>('child');

    return (
      <ContextProvider contexts={[]}>
        {phase === 'child' ? <ChildConsumer /> : null}
        {phase === 'direct' ? <DirectConsumer /> : null}
        <button data-testid="wrapped-clear" onClick={() => setPhase('none')}>
          Clear
        </button>
        <button data-testid="wrapped-direct" onClick={() => setPhase('direct')}>
          Direct
        </button>
      </ContextProvider>
    );
  };
}

/**
 * Uses the direct async reactive in the same child-first lifecycle.
 */
function createDirectApp({ getAsyncValue, getChildValue }: ReturnType<typeof createDirectChain>) {
  function ChildConsumer(): React.ReactNode {
    return <div data-testid="direct-value">{useReactive(getChildValue)}</div>;
  }

  function DirectConsumer(): React.ReactNode {
    const promise = useReactive(getAsyncValue);

    return <div data-testid="direct-value">{promise.value ?? 'pending'}</div>;
  }

  return function App(): React.ReactNode {
    const [phase, setPhase] = useState<'child' | 'none' | 'direct'>('child');

    return (
      <ContextProvider contexts={[]}>
        {phase === 'child' ? <ChildConsumer /> : null}
        {phase === 'direct' ? <DirectConsumer /> : null}
        <button data-testid="direct-clear" onClick={() => setPhase('none')}>
          Clear
        </button>
        <button data-testid="direct-direct" onClick={() => setPhase('direct')}>
          Direct
        </button>
      </ContextProvider>
    );
  };
}

describe('React > sync wrapper over async signal', () => {
  /**
   * Mirrors the cold-start deep-link path from the wallet app:
   * startup work mounts a child consumer that reaches the async signal through
   * a sync wrapper, that startup consumer unmounts, and then the deep-linked
   * screen mounts a direct consumer of the same wrapper in the same root scope
   * before the async value resolves. Under StrictMode, that direct consumer can
   * stay stuck on "pending" even after the async signal resolves.
   */
  test('can stay pending after switching from a child consumer to a direct consumer in StrictMode', async () => {
    const chain = createWrappedChain();
    const App = createWrappedApp(chain);

    const { getByTestId } = render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );

    await expect.element(getByTestId('wrapped-value')).toHaveTextContent('pending');

    await userEvent.click(getByTestId('wrapped-clear'));
    await sleep(0);

    await userEvent.click(getByTestId('wrapped-direct'));
    await expect.element(getByTestId('wrapped-value')).toHaveTextContent('pending');

    chain.resolve('ready');

    await expect.element(getByTestId('wrapped-value')).toHaveTextContent('ready');
  });

  /**
   * The React listener is on getChildValue (an intermediate signal), not on
   * getWrappedValue directly. When the component is suspended then immediately
   * resumed, resumeSignal does NOT cancel the pending deactivation because
   * _isActive is still true. The deactivation cascades from getChildValue,
   * fully resetting getWrappedValue and getAsyncValue (watchCount → 0).
   * The _stateSubs dirty notification hits getWrappedValue but it's already
   * Dirty (from reset) and its subs map is empty, so the dirty can't
   * propagate back up to getChildValue. The signal stays stuck on "pending".
   */
  test('resolves after suspend → resume when consuming through an intermediate signal', async () => {
    const chain = createWrappedChain();

    function Consumer(): React.ReactNode {
      return <div data-testid="value">{useReactive(chain.getChildValue)}</div>;
    }

    function App(): React.ReactNode {
      const [suspended, setSuspended] = useState(false);

      return (
        <ContextProvider contexts={[]}>
          <SuspendSignalsProvider value={suspended}>
            <Consumer />
          </SuspendSignalsProvider>
          <button
            data-testid="suspend-and-resume"
            onClick={() => {
              // flushSync forces the suspended=true render to complete
              // synchronously, so suspendSignal runs and schedules
              // deactivation. Then we immediately set suspended=false,
              // triggering resumeSignal in the next synchronous render.
              // No macrotask fires between them, so deactivation is
              // still pending when resumeSignal runs.
              flushSync(() => setSuspended(true));
              setSuspended(false);
            }}
          >
            Suspend and Resume
          </button>
        </ContextProvider>
      );
    }

    // No StrictMode — avoids the double-mount cycle accidentally
    // cancelling the pending deactivation.
    const { getByTestId } = render(<App />);

    await expect.element(getByTestId('value')).toHaveTextContent('pending');

    // Suspend + resume in a single event — deactivation is scheduled
    // but _isActive is still true when resumeSignal runs.
    await userEvent.click(getByTestId('suspend-and-resume'));

    // Resolve the async value
    chain.resolve('ready');

    await expect.element(getByTestId('value')).toHaveTextContent('ready');
  });

  test('direct async consumption still updates under the same StrictMode lifecycle', async () => {
    const chain = createDirectChain();
    const App = createDirectApp(chain);

    const { getByTestId } = render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );

    await expect.element(getByTestId('direct-value')).toHaveTextContent('pending');

    await userEvent.click(getByTestId('direct-clear'));
    await sleep(0);

    await userEvent.click(getByTestId('direct-direct'));
    await expect.element(getByTestId('direct-value')).toHaveTextContent('pending');

    chain.resolve('ready');

    await expect.element(getByTestId('direct-value')).toHaveTextContent('ready');
  });
});
