import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { signal } from 'signalium';
import { component } from 'signalium/react';
import { hashProps } from '../props-hash.js';

/**
 * `component()` skips hashing its props when every prop is identical (by `Object.is`) to the
 * previous render's, and falls back to the structural hash otherwise.
 */

function createHarness() {
  const counts = { inner: 0, hashReads: 0 };
  // A plain object is hashed by content, so hashing it reads `value` (through the getter).
  const makeData = (value: number) => ({
    get value() {
      counts.hashReads++;
      return value;
    },
  });

  const Inner = component((props: { label: string; data: { value: number }; onPress?: () => void }) => {
    counts.inner++;
    return <span data-testid="inner">{props.label}</span>;
  });

  return { counts, makeData, Inner };
}

describe('React > component() props hash fast path', () => {
  test('a parent re-render with identical props does not hash them', async () => {
    const { counts, makeData, Inner } = createHarness();
    const data = makeData(1);
    const onPress = () => {};

    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner label="a" data={data} onPress={onPress} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('a');
    const hashReadsAfterMount = counts.hashReads;
    expect(hashReadsAfterMount).toBeGreaterThan(0);
    expect(counts.inner).toBe(1);

    for (let i = 0; i < 10; i++) {
      flushSync(() => rerender());
    }

    expect(counts.hashReads).toBe(hashReadsAfterMount);
    expect(counts.inner).toBe(1);
    result.unmount();
  });

  test('a new but structurally equal prop is hashed and still reuses the element', async () => {
    const { counts, makeData, Inner } = createHarness();

    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner label="a" data={makeData(1)} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('a');
    const before = counts.hashReads;

    flushSync(() => rerender());

    expect(counts.hashReads).toBeGreaterThan(before);
    expect(counts.inner).toBe(1);
    result.unmount();
  });

  test('a changed prop, an added prop and a removed prop each re-render', async () => {
    const { counts, makeData, Inner } = createHarness();
    const data = makeData(1);

    let setProps: (p: { label: string; extra?: number }) => void = () => {};
    function Parent() {
      const [props, set] = useState<{ label: string; extra?: number }>({ label: 'a' });
      setProps = set;
      return <Inner data={data} {...props} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('a');
    expect(counts.inner).toBe(1);

    flushSync(() => setProps({ label: 'b' }));
    expect(counts.inner).toBe(2);

    // Same values, one more key (even an undefined one changes the structural hash).
    flushSync(() => setProps({ label: 'b', extra: undefined }));
    expect(counts.inner).toBe(3);

    flushSync(() => setProps({ label: 'b' }));
    expect(counts.inner).toBe(4);
    result.unmount();
  });

  test('NaN props compare as identical', async () => {
    const { counts, Inner } = createHarness();
    const data = { value: NaN };

    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner label="a" data={data} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('a');
    flushSync(() => rerender());
    expect(counts.inner).toBe(1);
    result.unmount();
  });

  test('a prop mutated in place under the same identity is not re-hashed (props are immutable)', async () => {
    // Documents the contract: same as React.memo and the React Compiler. Structural hashing used
    // to notice this mutation because plain objects hash by content.
    const counts = { inner: 0 };
    const Inner = component((props: { data: { value: number } }) => {
      counts.inner++;
      return <span data-testid="inner">{props.data.value}</span>;
    });

    const data = { value: 1 };
    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner data={data} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('1');

    const hashBefore = hashProps({ data });
    data.value = 2;
    expect(hashProps({ data })).not.toBe(hashBefore);

    flushSync(() => rerender());
    expect(counts.inner).toBe(1);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('1');
    result.unmount();
  });

  test('reactive data read inside the component still updates with identical props', async () => {
    const counts = { inner: 0 };
    const entity = { price: signal(1) };
    const Inner = component((props: { entity: typeof entity }) => {
      counts.inner++;
      return <span data-testid="inner">{props.entity.price.value}</span>;
    });

    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner entity={entity} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('1');

    entity.price.value = 2;
    flushSync(() => rerender());
    await expect.element(result.getByTestId('inner')).toHaveTextContent('2');
    result.unmount();
  });

  test('async component() uses the same fast path', async () => {
    const { counts, makeData } = createHarness();
    const data = makeData(1);
    let innerRenders = 0;
    const Inner = component(async (props: { data: { value: number } }) => {
      innerRenders++;
      return <span data-testid="inner">{props.data === data ? 'same' : 'other'}</span>;
    });

    let rerender: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      rerender = () => setN(n + 1);
      return <Inner data={data} />;
    }

    const result = render(<Parent />);
    await expect.element(result.getByTestId('inner')).toHaveTextContent('same');
    const before = counts.hashReads;
    const rendersBefore = innerRenders;
    flushSync(() => rerender());
    flushSync(() => rerender());
    expect(counts.hashReads).toBe(before);
    expect(innerRenders).toBe(rendersBefore);
    result.unmount();
  });
});
