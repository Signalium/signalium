import { describe, expect, test, afterEach } from 'vitest';
import { reactive, setRequestScopeGetter } from 'signalium';
import { SignalScope } from '../internals/contexts.js';

afterEach(() => {
  setRequestScopeGetter(undefined);
});

describe('setRequestScopeGetter', () => {
  test('sequential simulated requests do not share reactive signal cache for the same args', async () => {
    let activeScope: SignalScope | null = null;
    setRequestScopeGetter(() => activeScope ?? undefined);

    let counter = 0;
    const load = reactive(async (id: string) => {
      await Promise.resolve();
      return `${id}:${++counter}`;
    });

    activeScope = new SignalScope([]);
    const a = await load('x');

    activeScope = new SignalScope([]);
    const b = await load('x');

    expect(a).toBe('x:1');
    expect(b).toBe('x:2');
  });

  test('await preserves getter-supplied scope', async () => {
    let activeScope: SignalScope | null = null;
    setRequestScopeGetter(() => activeScope ?? undefined);

    let counter = 0;
    const load = reactive(async (id: string) => {
      await Promise.resolve();
      return `${id}:${++counter}`;
    });

    activeScope = new SignalScope([]);
    const a = await (async () => {
      await Promise.resolve();
      return await load('y');
    })();

    activeScope = new SignalScope([]);
    const b = await (async () => {
      await Promise.resolve();
      return await load('y');
    })();

    expect(a).toBe('y:1');
    expect(b).toBe('y:2');
  });

  test('nested getter scopes: inner activeScope wins while set', async () => {
    let outerScope = new SignalScope([]);
    let innerScope = new SignalScope([]);
    let active: SignalScope = outerScope;
    setRequestScopeGetter(() => active);

    let counter = 0;
    const load = reactive(async (id: string) => {
      await Promise.resolve();
      return `${id}:${++counter}`;
    });

    const outerFirst = await load('n');
    active = innerScope;
    const innerOnly = await load('n');
    active = outerScope;
    const outerSecond = await load('n');

    expect(innerOnly).not.toBe(outerFirst);
    expect(outerSecond).toBe(outerFirst);
  });

  test('without getter, same-args reactive shares one global signal', async () => {
    let counter = 0;
    const load = reactive(async (id: string) => {
      await Promise.resolve();
      return `${id}:${++counter}`;
    });

    const first = await load('z');
    const second = await load('z');
    expect(first).toBe(second);
    expect(counter).toBe(1);
  });
});
