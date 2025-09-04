import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, relay } from 'signalium';
import { useReactive, useSignal } from '../index.js';
import React, { useState } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';
import { createRenderCounter } from './utils.js';
import component from '../component.js';

describe('React > Components', () => {
  test('basic state usage works', async () => {
    const text = signal('Hello');

    const Component = component(() => <div>{text.value}</div>);

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';

    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('useSignal works', async () => {
    const Component = component(() => {
      const text = useSignal('Hello');

      return (
        <div>
          {text.value}
          <button onClick={() => (text.value = 'World')}>Toggle</button>
        </div>
      );
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    await userEvent.click(getByText('Toggle'));

    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('basic reactive function usage works', async () => {
    const text = signal('Hello');

    const derived = reactive(() => `${text.value}, World`);

    const Component = component(() => <div>{derived()}</div>);

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    text.value = 'Hey';

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('reactive function updates when params change', async () => {
    const text = signal('Hello');

    const derived = reactive((universe: boolean) => `${text.value}, ${universe ? 'Universe' : 'World'}`);

    const Component = component(() => {
      const [universe, setUniverse] = useState(true);

      return (
        <div>
          {derived(universe)}
          <button onClick={() => setUniverse(!universe)}>Toggle Universe</button>
        </div>
      );
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();

    text.value = 'Hey';

    await expect.element(getByText('Hey, Universe')).toBeInTheDocument();

    await userEvent.click(getByText('Toggle Universe'));

    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('does not re-render if reactive function returns the same value', async () => {
    const count = signal(0);
    const parity = reactive(() => (count.value % 2 === 0 ? 'even' : 'odd'));

    const Child = createRenderCounter(() => <div>{parity()}</div>, component);
    const Component = component(() => <Child />);

    const { getByText, getByTestId } = render(<Component />);

    await expect.element(getByText('even')).toBeInTheDocument();
    expect(getByTestId(String(Child.testId))).toBeDefined();
    expect(Child.renderCount).toBe(2);

    // Update by +2 keeps parity the same; should not re-render Child
    count.value = 2;
    await expect.element(getByText('even')).toBeInTheDocument();
    expect(Child.renderCount).toBe(2);

    // Update by +1 changes parity; should re-render Child
    count.value = 3;
    await expect.element(getByText('odd')).toBeInTheDocument();
    expect(Child.renderCount).toBe(3);
  });

  test('semi-deep-diffs parameters', async () => {
    type Params = { greet: string; nested: { to: string } };

    const derived = reactive((p: Params) => `${p.greet}, ${p.nested.to}`);

    const Child = createRenderCounter(({ params }: { params: Params }) => <div>{derived(params)}</div>, component);

    const Component = component(() => {
      const [params, setParams] = useState<Params>({ greet: 'Hello', nested: { to: 'World' } });

      return (
        <div>
          <Child params={params} />
          <button onClick={() => setParams({ greet: 'Hello', nested: { to: 'World' } })}>Same</button>
          <button onClick={() => setParams({ greet: 'Hello', nested: { to: 'Universe' } })}>Change</button>
        </div>
      );
    });

    const { getByText, getByTestId } = render(<Component />);

    await expect.element(getByText('Hello, World')).toBeInTheDocument();
    expect(getByTestId(String(Child.testId))).toBeDefined();
    expect(Child.renderCount).toBe(2);

    await userEvent.click(getByText('Same'));
    await expect.element(getByText('Hello, World')).toBeInTheDocument();
    // No re-render because params are structurally equal (semi-deep-equal)
    expect(Child.renderCount).toBe(2);

    await userEvent.click(getByText('Change'));
    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();
    expect(Child.renderCount).toBe(3);
  });

  test('works with conditional signal access', async () => {
    const flag = signal(true);
    const a = signal('A');
    const b = signal('B');

    const derived = reactive(() => (flag.value ? a.value : b.value));

    const Component = component(() => <div>{derived()}</div>);

    const { getByText } = render(<Component />);

    await expect.element(getByText('A')).toBeInTheDocument();

    // Updating non-active branch should not change output
    b.value = 'B2';
    await expect.element(getByText('A')).toBeInTheDocument();

    a.value = 'A2';
    await expect.element(getByText('A2')).toBeInTheDocument();

    flag.value = false;
    await expect.element(getByText('B2')).toBeInTheDocument();

    a.value = 'A3';
    await expect.element(getByText('B2')).toBeInTheDocument();

    b.value = 'B3';
    await expect.element(getByText('B3')).toBeInTheDocument();
  });

  test('works with conditional reactive function calls', async () => {
    const a = signal('A');
    const b = signal('B');
    const useA = signal(true);

    const readA = reactive(() => a.value);
    const readB = reactive(() => b.value);
    const choose = reactive(() => (useA.value ? readA() : readB()));

    const Component = component(() => <div>{choose()}</div>);

    const { getByText } = render(<Component />);

    await expect.element(getByText('A')).toBeInTheDocument();

    b.value = 'B2';
    await expect.element(getByText('A')).toBeInTheDocument();

    a.value = 'A2';
    await expect.element(getByText('A2')).toBeInTheDocument();

    useA.value = false;
    await expect.element(getByText('B2')).toBeInTheDocument();

    b.value = 'B3';
    await expect.element(getByText('B3')).toBeInTheDocument();
  });

  test('works with hooks', async () => {
    const greeting = signal('Hello');
    const name = signal('World');
    const derived = reactive(() => `${greeting.value}, ${name.value}`);

    const Component = component(() => {
      const local = useSignal('!');
      return (
        <div>
          {useReactive(derived)}
          {useReactive(local)}
          <button onClick={() => (name.value = 'Universe')}>Name</button>
          <button onClick={() => (greeting.value = 'Hi')}>Greeting</button>
          <button onClick={() => (local.value = '?')}>Local</button>
        </div>
      );
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello, World!')).toBeInTheDocument();

    await userEvent.click(getByText('Name'));
    await expect.element(getByText('Hello, Universe!')).toBeInTheDocument();

    await userEvent.click(getByText('Greeting'));
    await expect.element(getByText('Hi, Universe!')).toBeInTheDocument();

    await userEvent.click(getByText('Local'));
    await expect.element(getByText('Hi, Universe?')).toBeInTheDocument();
  });

  test('works with async reactive functions', async () => {
    const value = signal('Hello');

    const derived = reactive(async () => {
      const v = value.value;
      await sleep(50);
      return `${v}, World`;
    });

    const GrandChild = component(({ text }: { text: string }) => <span>{text}</span>);

    const Child = component(({ asyncValue }: { asyncValue: { isPending: boolean; value: string | undefined } }) => {
      return <div>{asyncValue.isPending ? 'Loading...' : <GrandChild text={asyncValue.value!} />}</div>;
    });

    const Component = component(() => {
      const d = derived();
      return <Child asyncValue={d} />;
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    value.value = 'Hey';
    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hey, World')).toBeInTheDocument();
  });

  test('works with nested components', async () => {
    const text = signal('Hello');

    const Child = component(() => <div>{text.value}</div>);
    const Parent = component(() => (
      <div>
        <Child />
      </div>
    ));

    const { getByText } = render(<Parent />);

    await expect.element(getByText('Hello')).toBeInTheDocument();
    text.value = 'World';
    await expect.element(getByText('World')).toBeInTheDocument();
  });

  test('works with relays', async () => {
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

    const Child = component(({ asyncValue }: { asyncValue: { isPending: boolean; value: string | undefined } }) => {
      return <div>{asyncValue.isPending ? 'Loading...' : <span>{asyncValue.value}</span>}</div>;
    });

    const Component = component(() => {
      const d = derived();
      return <Child asyncValue={d} />;
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    content.value = 'Universe';
    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();
  });

  test('callbacks can be used to create reactive closures', async () => {
    const Component = component(() => {
      const count = useSignal(0);

      const doubled = reactive(() => count.value * 2);

      return (
        <div>
          {doubled()}
          <button onClick={() => count.value++}>Increment</button>
        </div>
      );
    });

    const { getByText } = render(<Component />);

    await expect.element(getByText('0')).toBeInTheDocument();

    await userEvent.click(getByText('Increment'));

    await expect.element(getByText('2')).toBeInTheDocument();

    await userEvent.click(getByText('Increment'));

    await expect.element(getByText('4')).toBeInTheDocument();
  });
});
