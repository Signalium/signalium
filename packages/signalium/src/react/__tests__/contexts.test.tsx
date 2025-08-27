import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, context, setGlobalContexts } from '../../index.js';
import { ContextProvider, useReactive, useContext } from '../index.js';
import React from 'react';
import { useScope } from '../context.js';

describe('React > contexts', () => {
  test('useContext works inside computed with default value', async () => {
    const value = signal('Hello');
    const ctx = context(value);

    const derived = reactive(() => `${useContext(ctx).value}, World`);

    function Component(): React.ReactNode {
      return <div>{useReactive(derived)}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    value.value = 'Hey';

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('useContext works at root level with default value', async () => {
    const value = signal('Hello');
    const ctx = context(value);

    function Component(): React.ReactNode {
      const v = useContext(ctx);

      return <div>{useReactive(v)}, World</div>;
    }

    const { getByText } = render(
      <ContextProvider contexts={[]}>
        <Component />
      </ContextProvider>,
    );

    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    value.value = 'Hey';

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('provider inherits from root scope', async () => {
    const defaultValue1 = signal('default1');
    const defaultValue2 = signal('default2');
    const ctx1 = context(defaultValue1);
    const ctx2 = context(defaultValue2);
    const rootOverride1 = signal('root1');
    const rootOverride2 = signal('root2');

    // Set root contexts
    setGlobalContexts([
      [ctx1, rootOverride1],
      [ctx2, rootOverride2],
    ]);

    // Component that uses both contexts
    function Component({ testId }: { testId: string }): React.ReactNode {
      const value1 = useContext(ctx1);
      const value2 = useContext(ctx2);
      const derived = reactive(() => `${value1.value}-${value2.value}`);
      return <div data-testid={testId}>{useReactive(derived)}</div>;
    }
    const localOverride1 = signal('local1');
    const localOverride2 = signal('local2');

    // Should inherit from root scope when no local overrides
    const { getByTestId } = render(
      <>
        <ContextProvider contexts={[]}>
          <Component testId="result" />
        </ContextProvider>
        <ContextProvider contexts={[[ctx1, localOverride1]]}>
          <Component testId="result2" />
        </ContextProvider>
        <ContextProvider
          contexts={[
            [ctx1, localOverride1],
            [ctx2, localOverride2],
          ]}
        >
          <Component testId="result3" />
        </ContextProvider>
      </>,
    );

    await expect.element(getByTestId('result')).toHaveTextContent('root1-root2');

    // Should inherit from root scope for unoverridden contexts
    await expect.element(getByTestId('result2')).toHaveTextContent('local1-root2');

    // Should use local overrides when provided
    await expect.element(getByTestId('result3')).toHaveTextContent('local1-local2');

    // Changes to root contexts should be reflected in inherited contexts
    rootOverride1.value = 'updated-root1';
    rootOverride2.value = 'updated-root2';

    await expect.element(getByTestId('result')).toHaveTextContent('updated-root1-updated-root2');

    // Local overrides should remain unaffected by root context changes
    await expect.element(getByTestId('result2')).toHaveTextContent('local1-updated-root2');
    await expect.element(getByTestId('result3')).toHaveTextContent('local1-local2');
  });

  test('useContext works inside computed value passed via context provider', async () => {
    const value = signal('Hello');
    const override = signal('Hey');
    const ctx = context(value);

    const derived = reactive(() => `${useContext(ctx).value}, World`);

    function Component(): React.ReactNode {
      return <div>{useReactive(derived)}</div>;
    }

    const { getByText } = render(
      <ContextProvider contexts={[[ctx, override]]}>
        <Component />
      </ContextProvider>,
    );

    await expect.element(getByText('Hey, World')).toBeInTheDocument();

    override.value = 'Hi';

    await expect.element(getByText('Hi, World')).toBeInTheDocument();
  });

  test('useContext works at root level with default value', async () => {
    const value = signal('Hello');
    const override = signal('Hey');
    const ctx = context(value);

    function Component(): React.ReactNode {
      const v = useContext(ctx);

      return <div>{useReactive(v)}, World</div>;
    }

    const { getByText } = render(
      <ContextProvider contexts={[[ctx, override]]}>
        <Component />
      </ContextProvider>,
    );

    await expect.element(getByText('Hey, World')).toBeInTheDocument();

    override.value = 'Hi';

    await expect.element(getByText('Hi, World')).toBeInTheDocument();
  });

  test('useScope throws outside of rendering context', async () => {
    // Direct call outside of rendering should return undefined
    expect(() => useScope()).toThrow();

    // Inside a component during rendering, it should return the scope
    function TestComponent() {
      const scope = useScope();
      return <div data-testid="scope">{scope ? 'has-scope' : 'no-scope'}</div>;
    }

    const { getByTestId } = render(
      <ContextProvider contexts={[]}>
        <TestComponent />
      </ContextProvider>,
    );

    await expect.element(getByTestId('scope')).toHaveTextContent('has-scope');
  });
});
