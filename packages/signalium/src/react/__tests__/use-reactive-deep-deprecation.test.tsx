import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal } from 'signalium';
import { useReactiveDeep } from 'signalium/react';
import React from 'react';

describe('React > useReactiveDeep (deprecated alias)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('still works (delegates to useReactive) and fires a dev-time deprecation warning', async () => {
    const text = signal('Hello');

    function Component(): React.ReactNode {
      return <div>{useReactiveDeep(() => text.value)}</div>;
    }

    const { getByText } = render(<Component />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';
    await expect.element(getByText('World')).toBeInTheDocument();

    // At least one call to console.warn with the deprecation message.
    const warnedOnce = warnSpy.mock.calls.some(args =>
      args.some(a => typeof a === 'string' && a.includes('`useReactiveDeep` is deprecated')),
    );
    expect(warnedOnce).toBe(true);
  });
});
