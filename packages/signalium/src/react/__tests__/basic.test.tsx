import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive } from 'signalium';
import { useReactive, useSignal } from 'signalium/react';
import React, { useState } from 'react';
import { userEvent } from '@vitest/browser/context';

describe('React > basic', () => {
  test('basic state usage works', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      return <div>{useReactive(() => text.value)}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';

    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('useSignal works', async () => {
    function Component(): React.ReactNode {
      const text = useSignal('Hello');

      return (
        <div>
          {useReactive(() => text.value)}
          <button onClick={() => (text.value = 'World')}>Toggle</button>
        </div>
      );
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    await userEvent.click(getByText('Toggle'));

    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('basic computed usage works', async () => {
    const text = signal('Hello');

    const derived = reactive(() => `${text.value}, World`);

    function Component(): React.ReactNode {
      return <div>{useReactive(() => derived())}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    text.value = 'Hey';

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('computed updates when params change', async () => {
    const text = signal('Hello');

    const derived = reactive((universe: boolean) => `${text.value}, ${universe ? 'Universe' : 'World'}`);

    function Component(): React.ReactNode {
      const [universe, setUniverse] = useState(true);

      return (
        <div>
          {useReactive(() => derived(universe))}
          <button onClick={() => setUniverse(!universe)}>Toggle Universe</button>
        </div>
      );
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();

    text.value = 'Hey';

    await expect.element(getByText('Hey, Universe')).toBeInTheDocument();

    await userEvent.click(getByText('Toggle Universe'));

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });
});
