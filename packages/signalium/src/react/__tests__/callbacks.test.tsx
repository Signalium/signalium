import { describe, expect, test } from 'vitest';
import React, { useCallback, useState } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from '@vitest/browser/context';
import { signal, reactive, context, getContext } from 'signalium';
import { component, useSignal, ContextProvider } from 'signalium/react';
import { createRenderCounter } from './utils.js';
import { sleep } from '../../__tests__/utils/async.js';

describe('React > callbacks inside component()', () => {
  test('callback created in component has correct scope with contexts', async () => {
    const ctx = context('default');

    const Show = component(() => {
      const [ctxValue, setCtxValue] = useState('default');
      const cb = () => getContext(ctx);
      return <button onClick={() => setCtxValue(cb())}>{ctxValue}</button>;
    });

    const { getByRole } = render(
      <ContextProvider contexts={[[ctx, 'context']]}>
        <Show />
      </ContextProvider>,
    );

    await expect.element(getByRole('button', { name: 'default' })).toBeInTheDocument();

    await userEvent.click(getByRole('button', { name: 'default' }));

    await expect.element(getByRole('button', { name: 'context' })).toBeInTheDocument();
  });

  test('callback created in component has correct scope with contexts', async () => {
    const ctx = context('default');

    const inner = reactive(() => getContext(ctx));

    const Show = component(() => {
      const [ctxValue, setCtxValue] = useState('default');
      const cb = () => () => () => inner();
      return (
        <button
          onClick={() => {
            const cb2 = cb();
            setTimeout(() => {
              setCtxValue(cb2());
            }, 100);
          }}
        >
          {ctxValue}
        </button>
      );
    });

    const { getByRole } = render(
      <ContextProvider contexts={[[ctx, 'context']]}>
        <Show />
      </ContextProvider>,
    );

    await expect.element(getByRole('button', { name: 'default' })).toBeInTheDocument();

    await userEvent.click(getByRole('button', { name: 'default' }));

    await expect.element(getByRole('button', { name: 'context' })).toBeInTheDocument();
  });

  test('callback created in component reactive compute has correct scope with contexts', async () => {
    const ctx = context('default');

    const inner = reactive(() => getContext(ctx));
    const makeCb = reactive(() => () => inner());

    const Show = component(() => {
      const [ctxValue, setCtxValue] = useState('default');
      const cb = makeCb();
      return <button onClick={() => setCtxValue(cb())}>{ctxValue}</button>;
    });

    const { getByRole } = render(
      <ContextProvider contexts={[[ctx, 'context']]}>
        <Show />
      </ContextProvider>,
    );

    await expect.element(getByRole('button', { name: 'default' })).toBeInTheDocument();

    await userEvent.click(getByRole('button', { name: 'default' }));

    await expect.element(getByRole('button', { name: 'context' })).toBeInTheDocument();
  });

  test('nested callbacks in reactives maintain scope across levels in component', async () => {
    const ctx = context('default');

    const inner = reactive(() => getContext(ctx));

    const makeNestedCb = reactive(() => () => () => inner());

    const Show = component(() => {
      const [ctxValue, setCtxValue] = useState('default');
      const cb = makeNestedCb();
      return (
        <button
          onClick={() => {
            const cb2 = cb();
            setTimeout(() => {
              setCtxValue(cb2());
            }, 100);
          }}
        >
          {ctxValue}
        </button>
      );
    });

    const { getByRole } = render(
      <ContextProvider contexts={[[ctx, 'context']]}>
        <Show />
      </ContextProvider>,
    );

    await expect.element(getByRole('button', { name: 'default' })).toBeInTheDocument();

    await userEvent.click(getByRole('button', { name: 'default' }));

    await expect.element(getByRole('button', { name: 'context' })).toBeInTheDocument();
  });

  test('callback identity is stable unless deps change; receivers re-render appropriately', async () => {
    const toggle = signal(true);
    const unrelated = signal(0);

    const makeCb = reactive(() => {
      void unrelated.value; // cause outer recompute without changing deps
      const local = toggle.value ? 1 : 2;
      return (n: number) => n + local;
    });

    const Child = createRenderCounter(({ fn }: { fn: (n: number) => number }) => <span>{fn(10)}</span>, component);

    const Parent = component(() => {
      const cb = makeCb();
      return <Child fn={cb} />;
    });

    const { getByText, getByTestId } = render(<Parent />);
    await expect.element(getByText('11')).toBeInTheDocument();
    expect(getByTestId(String(Child.testId))).toBeDefined();
    expect(Child.renderCount).toBe(2);

    // Change unrelated: makeCb recomputes but callback deps unchanged -> same identity -> Child should NOT re-render
    unrelated.value = 1;
    await expect.element(getByText('11')).toBeInTheDocument();
    expect(Child.renderCount).toBe(2);

    // Change toggle: deps change -> new callback identity -> Child re-renders and value updates
    toggle.value = false;
    await expect.element(getByText('12')).toBeInTheDocument();
    expect(Child.renderCount).toBe(3);
  });

  test('async callback maintains captured scope after await in component', async () => {
    const ctx = context('default');

    const makeAsyncCb = reactive(() => async () => {
      await sleep(10);
      return getContext(ctx);
    });

    const Runner = component(() => {
      const result = useSignal<string | null>(null);
      const cb = makeAsyncCb();
      const run = useCallback(async () => {
        result.value = await cb();
      }, [cb, result]);
      return (
        <div>
          <button onClick={run}>Run</button>
          <div>{result.value}</div>
        </div>
      );
    });

    const { getByText } = render(
      <ContextProvider contexts={[[ctx, 'child']]}>
        <Runner />
      </ContextProvider>,
    );

    await userEvent.click(getByText('Run'));
    await expect.element(getByText('child')).toBeInTheDocument();
  });
});
