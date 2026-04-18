import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive } from 'signalium';
import { useReactiveShallow } from 'signalium/react';
import React from 'react';

describe('React > useReactiveShallow', () => {
  test('returns the signal value by reference without cloning', async () => {
    const obj = { name: 'Alice' };
    const source = signal(obj);

    let capturedResult: { name: string } | undefined;

    function Component(): React.ReactNode {
      const result = useReactiveShallow(() => source.value);
      capturedResult = result;
      return <div>{result.name}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Alice')).toBeInTheDocument();

    // No structural cloning — same reference as the original object.
    expect(capturedResult).toBe(obj);
  });

  test('preserves reference equality when the underlying reactive fn returns the same instance', async () => {
    const multiplier = signal(2);
    const stable = { id: 'stable' };

    // Returns the same `stable` object each run; only `m` changes. A shallow
    // read hands back `stable` by reference, while a deep read would produce
    // a fresh snapshot.
    const derived = reactive(() => ({ wrapper: stable, m: multiplier.value }));

    let last: { wrapper: typeof stable; m: number } | undefined;

    function Component(): React.ReactNode {
      const result = useReactiveShallow(() => derived());
      last = result;
      return <div data-testid="out">{result.m}</div>;
    }

    const { getByTestId } = render(<Component />);

    await expect.element(getByTestId('out')).toHaveTextContent('2');
    const firstWrapper = last!.wrapper;
    expect(firstWrapper).toBe(stable);

    multiplier.value = 3;
    await expect.element(getByTestId('out')).toHaveTextContent('3');

    // The reactive fn re-ran and produced a new outer object, but the nested
    // `stable` reference is preserved because we didn't snapshot.
    expect(last).not.toBe(firstWrapper);
    expect(last!.wrapper).toBe(stable);
  });

  test('updates when the signal value changes', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      return <div>{useReactiveShallow(() => text.value)}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';

    await expect.element(getByText('World')).toBeInTheDocument();
  });
});
