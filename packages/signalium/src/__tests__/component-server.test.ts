import { describe, expect, test, afterEach } from 'vitest';
import { reactive, setRequestScopeGetter } from 'signalium';
import { SignalScope } from '../internals/contexts.js';
import serverComponent from '../react/component-server.js';

afterEach(() => {
  setRequestScopeGetter(undefined);
});

describe('component-server (react-server entry)', () => {
  test('generator component returns an async function that resolves with the rendered value', async () => {
    const scope = new SignalScope([]);
    setRequestScopeGetter(() => scope);

    const load = reactive(async (id: string) => {
      await Promise.resolve();
      return `v:${id}`;
    });

    const MyComponent = serverComponent(function* (_props: object) {
      const v = yield load('x');
      return { type: 'span', props: { children: String(v) } } as any;
    });

    const result = await MyComponent({});
    expect(result).toEqual({ type: 'span', props: { children: 'v:x' } });
  });

  test('sync component returns a function that renders synchronously', () => {
    const scope = new SignalScope([]);
    setRequestScopeGetter(() => scope);

    const MyComponent = serverComponent((_props: object) => {
      return { type: 'div', props: { children: 'hello' } } as any;
    });

    const result = MyComponent({});
    expect(result).toEqual({ type: 'div', props: { children: 'hello' } });
  });

  test('async component uses per-request scope (no cross-request caching)', async () => {
    let counter = 0;
    const load = reactive(async () => {
      await Promise.resolve();
      return `call:${++counter}`;
    });

    const MyComponent = serverComponent(function* (_props: object) {
      const v = yield load();
      return String(v);
    });

    setRequestScopeGetter(() => new SignalScope([]));
    const a = await MyComponent({});

    setRequestScopeGetter(() => new SignalScope([]));
    const b = await MyComponent({});

    expect(a).toBe('call:1');
    expect(b).toBe('call:2');
  });

  test('throws for un-transformed async function', () => {
    expect(() => {
      serverComponent(async (_props: object) => null);
    }).toThrow(/Babel preset/);
  });
});
