import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive } from 'signalium';
import { registerCustomSnapshot, snapshot } from 'signalium/utils';
import { useReactive } from 'signalium/react';
import React, { memo, useState } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';

describe('React > useReactive (deep, default)', () => {
  describe('primitives', () => {
    test('returns string values and updates on change', async () => {
      const text = signal('Hello');
      const derived = reactive(() => text.value);

      function Component(): React.ReactNode {
        return <div>{useReactive(() => derived())}</div>;
      }

      const { getByText } = render(<Component />);

      await expect.element(getByText('Hello')).toBeInTheDocument();

      text.value = 'World';

      await expect.element(getByText('World')).toBeInTheDocument();
    });

    test('returns number values and updates on change', async () => {
      const num = signal(42);
      const derived = reactive(() => num.value);

      function Component(): React.ReactNode {
        return <div>{useReactive(() => derived())}</div>;
      }

      const { getByText } = render(<Component />);

      await expect.element(getByText('42')).toBeInTheDocument();

      num.value = 99;

      await expect.element(getByText('99')).toBeInTheDocument();
    });

    test('returns null without crashing', async () => {
      const val = signal<string | null>(null);
      const derived = reactive(() => val.value);

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        return <div>{result === null ? 'null' : result}</div>;
      }

      const { getByText } = render(<Component />);

      await expect.element(getByText('null')).toBeInTheDocument();

      val.value = 'present';

      await expect.element(getByText('present')).toBeInTheDocument();
    });
  });

  describe('plain objects -- structural sharing', () => {
    test('returns a snapshot that is not the same reference as the signal value', async () => {
      const original = { a: 1, b: 'hello' };
      const obj = signal(original);
      const derived = reactive(() => obj.value);

      let capturedSnapshot: unknown;
      let capturedOriginal: unknown;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        capturedSnapshot = result;
        capturedOriginal = obj.value;
        return <div>{JSON.stringify(result)}</div>;
      }

      const { getByText } = render(<Component />);

      await expect.element(getByText('{"a":1,"b":"hello"}')).toBeInTheDocument();
      expect(capturedSnapshot).not.toBe(capturedOriginal);
      expect(capturedSnapshot).toEqual({ a: 1, b: 'hello' });
    });

    test('returns the same snapshot reference when value has not changed', async () => {
      const a = signal(1);
      const b = signal('hello');
      const derived = reactive(() => ({ a: a.value, b: b.value }));

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{JSON.stringify(result)}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('{"a":1,"b":"hello"}');

      const snapshotBeforeRerender = snapshots[snapshots.length - 1];

      // Trigger a parent re-render without changing signals.
      // The snapshot function should return the same reference.
      a.value = 1; // same value
      await sleep(50);

      // Snapshot reference should be stable
      expect(snapshots[snapshots.length - 1]).toBe(snapshotBeforeRerender);
    });

    test('returns a new reference when a nested property changes', async () => {
      const name = signal('Alice');
      const age = signal(30);
      const derived = reactive(() => ({ name: name.value, age: age.value }));

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{JSON.stringify(result)}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('{"name":"Alice","age":30}');

      const first = snapshots[snapshots.length - 1];

      name.value = 'Bob';

      await expect.element(getByTestId('out')).toHaveTextContent('{"name":"Bob","age":30}');

      const second = snapshots[snapshots.length - 1];
      expect(second).not.toBe(first);
      expect(second).toEqual({ name: 'Bob', age: 30 });
    });

    test('preserves unchanged subtree references (structural sharing)', async () => {
      const x = signal(1);
      const stableChild = { nested: 'stable' };
      const derived = reactive(() => ({ x: x.value, child: stableChild }));

      const snapshots: Array<{ x: number; child: { nested: string } }> = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { x: number; child: { nested: string } };
        snapshots.push(result);
        return <div data-testid="out">{result.x}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1');

      const firstChild = snapshots[snapshots.length - 1].child;

      x.value = 2;

      await expect.element(getByTestId('out')).toHaveTextContent('2');

      const secondChild = snapshots[snapshots.length - 1].child;

      // Top-level object changed, but child subtree is structurally the same
      expect(snapshots[snapshots.length - 1]).not.toBe(snapshots[0]);
      expect(secondChild).toBe(firstChild);
    });
  });

  describe('arrays -- structural sharing', () => {
    test('clones arrays and updates when elements change', async () => {
      const items = signal(['a', 'b', 'c']);
      const derived = reactive(() => items.value);

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as string[];
        return <div data-testid="out">{result.join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('a,b,c');

      items.value = ['a', 'b', 'd'];

      await expect.element(getByTestId('out')).toHaveTextContent('a,b,d');
    });

    test('returns same array reference when unchanged', async () => {
      const trigger = signal(0);
      const stableArray = ['x', 'y'];
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value; // subscribe but don't use
        return stableArray;
      });

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{(result as string[]).join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('x,y');

      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      // Array content unchanged, so snapshot should return same reference
      expect(snapshots[snapshots.length - 1]).toBe(first);
    });

    test('preserves unchanged element references within arrays', async () => {
      const flag = signal(false);
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const derived = reactive(() => [obj1, flag.value ? { id: 3 } : obj2]);

      const snapshots: Array<Array<{ id: number }>> = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as Array<{ id: number }>;
        snapshots.push(result);
        return <div data-testid="out">{result.map(o => o.id).join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1,2');

      const firstArr = snapshots[snapshots.length - 1];

      flag.value = true;

      await expect.element(getByTestId('out')).toHaveTextContent('1,3');

      const secondArr = snapshots[snapshots.length - 1];

      expect(secondArr).not.toBe(firstArr);
      // First element unchanged
      expect(secondArr[0]).toBe(firstArr[0]);
      // Second element changed
      expect(secondArr[1]).not.toBe(firstArr[1]);
    });
  });

  describe('nested structures', () => {
    test('deeply nested objects clone correctly', async () => {
      const val = signal('deep');
      const derived = reactive(() => ({
        level1: {
          level2: {
            level3: val.value,
          },
        },
      }));

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        return <div data-testid="out">{result.level1.level2.level3}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('deep');

      val.value = 'changed';

      await expect.element(getByTestId('out')).toHaveTextContent('changed');
    });

    test('mixed objects-in-arrays and arrays-in-objects', async () => {
      const val = signal(1);
      const derived = reactive(() => ({
        items: [{ value: val.value }, { value: val.value * 2 }],
      }));

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        return (
          <div data-testid="out">
            {result.items[0].value},{result.items[1].value}
          </div>
        );
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1,2');

      val.value = 5;

      await expect.element(getByTestId('out')).toHaveTextContent('5,10');
    });
  });

  describe('class instances are not cloned', () => {
    test('Date instances pass through as-is', async () => {
      const date = new Date('2025-01-01');
      const derived = reactive(() => ({ created: date }));

      let capturedDate: Date | undefined;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { created: Date };
        capturedDate = result.created;
        return <div data-testid="out">{result.created.toISOString()}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('2025-01-01T00:00:00.000Z');
      expect(capturedDate).toBe(date);
    });

    test('custom class instances pass through as-is', async () => {
      class MyModel {
        constructor(public name: string) {}
      }

      const model = new MyModel('test');
      const derived = reactive(() => ({ model }));

      let capturedModel: MyModel | undefined;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { model: MyModel };
        capturedModel = result.model;
        return <div data-testid="out">{result.model.name}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('test');
      expect(capturedModel).toBe(model);
    });

    test('RegExp instances pass through as-is', async () => {
      const regex = /foo/gi;
      const derived = reactive(() => ({ pattern: regex }));

      let capturedRegex: RegExp | undefined;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { pattern: RegExp };
        capturedRegex = result.pattern;
        return <div data-testid="out">{result.pattern.source}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('foo');
      expect(capturedRegex).toBe(regex);
    });
  });

  describe('ReactivePromise snapshotting', () => {
    test('async reactive functions return a snapshot with promise fields', async () => {
      const val = signal('Hello');
      const derived = reactive(async () => {
        const v = val.value;
        await sleep(100);
        return `${v}, World`;
      });

      let capturedResult: any;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        capturedResult = result;
        const r = result as any;
        return <div data-testid="out">{r.isPending ? 'Loading...' : r.value}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Loading...');
      expect(capturedResult).toHaveProperty('isPending', true);
      expect(capturedResult).toHaveProperty('isReady', false);
      expect(capturedResult).toHaveProperty('value', undefined);

      await sleep(200);

      await expect.element(getByTestId('out')).toHaveTextContent('Hello, World');
      expect(capturedResult).toHaveProperty('isPending', false);
      expect(capturedResult).toHaveProperty('isReady', true);
      expect(capturedResult).toHaveProperty('value', 'Hello, World');
    });

    test('snapshot updates when promise resolves and value changes', async () => {
      const val = signal('first');
      const derived = reactive(async () => {
        const v = val.value;
        await sleep(50);
        return v;
      });

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        const r = result as any;
        return <div data-testid="out">{r.isPending && !r.isReady ? 'Loading...' : r.value}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Loading...');

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('first');

      const resolvedSnapshot = snapshots[snapshots.length - 1];

      val.value = 'second';

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('second');

      const updatedSnapshot = snapshots[snapshots.length - 1];
      expect(updatedSnapshot).not.toBe(resolvedSnapshot);
      expect(updatedSnapshot.value).toBe('second');
    });

    test('async result with nested object value is deep-cloned', async () => {
      const name = signal('Alice');
      const derived = reactive(async () => {
        const n = name.value;
        await sleep(50);
        return { user: { name: n } };
      });

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return (
          <div data-testid="out">{result.isPending && !result.isReady ? 'Loading...' : result.value?.user?.name}</div>
        );
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Loading...');

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('Alice');

      const firstResolved = snapshots[snapshots.length - 1];
      expect(firstResolved.value).toEqual({ user: { name: 'Alice' } });

      name.value = 'Bob';

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('Bob');

      const secondResolved = snapshots[snapshots.length - 1];
      expect(secondResolved.value).toEqual({ user: { name: 'Bob' } });
      expect(secondResolved.value).not.toBe(firstResolved.value);
    });
  });

  describe('param changes', () => {
    test('changing args picks up new inner signal and recreates clone signal', async () => {
      const derived = reactive((greeting: string) => ({ message: `${greeting}, World` }));

      function Component(): React.ReactNode {
        const [greeting, setGreeting] = useState('Hello');
        const result = useReactive(() => derived(greeting)) as { message: string };

        return (
          <div>
            <div data-testid="out">{result.message}</div>
            <button onClick={() => setGreeting('Hi')}>Change</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Hello, World');

      await userEvent.click(getByText('Change'));

      await expect.element(getByTestId('out')).toHaveTextContent('Hi, World');
    });

    test('reactive deps still work after param change', async () => {
      const suffix = signal('!');
      const derived = reactive((greeting: string) => ({
        message: `${greeting}, World${suffix.value}`,
      }));

      function Component(): React.ReactNode {
        const [greeting, setGreeting] = useState('Hello');
        const result = useReactive(() => derived(greeting)) as { message: string };

        return (
          <div>
            <div data-testid="out">{result.message}</div>
            <button onClick={() => setGreeting('Hi')}>Change</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Hello, World!');

      await userEvent.click(getByText('Change'));

      await expect.element(getByTestId('out')).toHaveTextContent('Hi, World!');

      suffix.value = '?';

      await expect.element(getByTestId('out')).toHaveTextContent('Hi, World?');
    });
  });

  describe('React.memo integration', () => {
    test('memo child does NOT re-render when value is structurally identical', async () => {
      const trigger = signal(0);
      const stableObj = { name: 'stable' };
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return stableObj;
      });

      let memoRenderCount = 0;

      const MemoChild = memo(({ data }: { data: { name: string } }) => {
        memoRenderCount++;
        return <div data-testid="child">{data.name}</div>;
      });

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { name: string };
        return <MemoChild data={result} />;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('child')).toHaveTextContent('stable');
      const countAfterMount = memoRenderCount;

      // Trigger a recompute of the reactive function, but return the same structure
      trigger.value = 1;
      await sleep(50);

      // memo child should not re-render because snapshot returns the same reference
      expect(memoRenderCount).toBe(countAfterMount);
    });

    test('memo child DOES re-render when value actually changes', async () => {
      const name = signal('Alice');
      const derived = reactive(() => ({ name: name.value }));

      let memoRenderCount = 0;

      const MemoChild = memo(({ data }: { data: { name: string } }) => {
        memoRenderCount++;
        return <div data-testid="child">{data.name}</div>;
      });

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { name: string };
        return <MemoChild data={result} />;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('child')).toHaveTextContent('Alice');
      const countAfterMount = memoRenderCount;

      name.value = 'Bob';

      await expect.element(getByTestId('child')).toHaveTextContent('Bob');
      expect(memoRenderCount).toBeGreaterThan(countAfterMount);
    });
  });

  describe('Map and Set', () => {
    test('Maps are cloned with structural sharing', async () => {
      const val = signal('v1');
      const derived = reactive(() => new Map([['key', val.value]]));

      const snapshots: Map<string, string>[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as Map<string, string>;
        snapshots.push(result);
        return <div data-testid="out">{result.get('key')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('v1');

      const first = snapshots[snapshots.length - 1];

      val.value = 'v2';

      await expect.element(getByTestId('out')).toHaveTextContent('v2');

      const second = snapshots[snapshots.length - 1];
      expect(second).not.toBe(first);
      expect(second.get('key')).toBe('v2');
    });

    test('unchanged Map returns same reference', async () => {
      const trigger = signal(0);
      const stableMap = new Map([['a', 1]]);
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return stableMap;
      });

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{(result as Map<string, number>).get('a')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1');
      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      expect(snapshots[snapshots.length - 1]).toBe(first);
    });

    test('Sets are cloned with structural sharing', async () => {
      const val = signal(1);
      const derived = reactive(() => new Set([val.value, val.value + 1]));

      const snapshots: Set<number>[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as Set<number>;
        snapshots.push(result);
        return <div data-testid="out">{Array.from(result).join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1,2');

      val.value = 10;

      await expect.element(getByTestId('out')).toHaveTextContent('10,11');

      expect(snapshots[snapshots.length - 1]).not.toBe(snapshots[0]);
    });

    test('unchanged Set returns same reference', async () => {
      const trigger = signal(0);
      const stableSet = new Set([1, 2, 3]);
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return stableSet;
      });

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{Array.from(result as Set<number>).join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('1,2,3');
      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      expect(snapshots[snapshots.length - 1]).toBe(first);
    });
  });

  describe('registerCustomSnapshot', () => {
    test('custom snapshot handler is called for registered class instances', async () => {
      class Counter {
        constructor(
          public count: number,
          public label: string,
        ) {}
      }

      registerCustomSnapshot(Counter, (current, prev, snap) => {
        const label = snap(current.label, (prev as any)?.label) as string;
        if (prev && current.count === (prev as any).count && label === (prev as any).label) {
          return prev;
        }
        return { count: current.count, label } as any;
      });

      const count = signal(0);
      const derived = reactive(() => new Counter(count.value, 'clicks'));

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return (
          <div data-testid="out">
            {result.label}: {result.count}
          </div>
        );
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('clicks: 0');

      const first = snapshots[snapshots.length - 1];
      expect(first).toEqual({ count: 0, label: 'clicks' });
      expect(first).not.toBeInstanceOf(Counter);

      count.value = 5;

      await expect.element(getByTestId('out')).toHaveTextContent('clicks: 5');

      const second = snapshots[snapshots.length - 1];
      expect(second).toEqual({ count: 5, label: 'clicks' });
      expect(second).not.toBe(first);
    });

    test('custom snapshot returns same ref when unchanged', async () => {
      class Box {
        constructor(public value: number) {}
      }

      registerCustomSnapshot(Box, (current, prev) => {
        if (prev && current.value === (prev as any).value) return prev;
        return { value: current.value } as any;
      });

      const trigger = signal(0);
      const box = new Box(42);
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return { box };
      });

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return <div data-testid="out">{result.box.value}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('42');
      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      expect(snapshots[snapshots.length - 1].box).toBe(first.box);
    });

    test('custom snapshot receives the recursive snapshot function for nested values', async () => {
      class Container {
        constructor(public items: Array<{ id: number; name: string }>) {}
      }

      registerCustomSnapshot(Container, (current, prev, snap) => {
        const items = snap(current.items, (prev as any)?.items) as Array<{ id: number; name: string }>;
        if (prev && items === (prev as any).items) return prev;
        return { items } as any;
      });

      const name = signal('Alice');
      const derived = reactive(
        () =>
          new Container([
            { id: 1, name: name.value },
            { id: 2, name: 'Bob' },
          ]),
      );

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return <div data-testid="out">{result.items.map((i: any) => i.name).join(',')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Alice,Bob');

      const first = snapshots[snapshots.length - 1];

      name.value = 'Carol';

      await expect.element(getByTestId('out')).toHaveTextContent('Carol,Bob');

      const second = snapshots[snapshots.length - 1];
      expect(second).not.toBe(first);
      // Bob's item should be structurally shared
      expect(second.items[1]).toBe(first.items[1]);
      expect(second.items[0]).not.toBe(first.items[0]);
    });

    test('custom snapshot registered on a base class applies to subclasses', async () => {
      class Entity {
        constructor(
          public id: number,
          public name: string,
        ) {}
      }

      registerCustomSnapshot(Entity, (current, prev, snap) => {
        const name = snap((current as Entity).name, (prev as any)?.name) as string;
        const id = (current as Entity).id;
        if (prev && id === (prev as any).id && name === (prev as any).name) return prev;
        return { id, name } as any;
      });

      // Subclass with no separate registration — should still flow through the
      // base-class handler via the prototype chain.
      class User extends Entity {}

      const name = signal('Alice');
      const derived = reactive(() => new User(1, name.value));

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return <div data-testid="out">{result.name}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Alice');

      const first = snapshots[snapshots.length - 1];
      expect(first).toEqual({ id: 1, name: 'Alice' });
      expect(first).not.toBeInstanceOf(User);

      name.value = 'Bob';

      await expect.element(getByTestId('out')).toHaveTextContent('Bob');

      const second = snapshots[snapshots.length - 1];
      expect(second).toEqual({ id: 1, name: 'Bob' });
      expect(second).not.toBe(first);
    });
  });

  describe('null-prototype objects', () => {
    test('Object.create(null) is treated as a plain object', async () => {
      const val = signal('hello');
      const derived = reactive(() => {
        const obj = Object.create(null) as Record<string, unknown>;
        obj.key = val.value;
        return obj;
      });

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        return <div data-testid="out">{result.key}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('hello');

      val.value = 'world';

      await expect.element(getByTestId('out')).toHaveTextContent('world');
    });
  });

  describe('edge cases', () => {
    test('empty object returns same ref when unchanged', async () => {
      const trigger = signal(0);
      const empty = {};
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return empty;
      });

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">empty</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('empty');
      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      expect(snapshots[snapshots.length - 1]).toBe(first);
    });

    test('empty array returns same ref when unchanged', async () => {
      const trigger = signal(0);
      const empty: unknown[] = [];
      const derived = reactive(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        trigger.value;
        return empty;
      });

      const snapshots: unknown[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">empty</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('empty');
      const first = snapshots[snapshots.length - 1];

      trigger.value = 1;
      await sleep(50);

      expect(snapshots[snapshots.length - 1]).toBe(first);
    });

    test('functions as values pass through as-is', async () => {
      const fn = () => 'hello';
      const derived = reactive(() => ({ callback: fn }));

      let capturedFn: unknown;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { callback: () => string };
        capturedFn = result.callback;
        return <div data-testid="out">{result.callback()}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('hello');
      expect(capturedFn).toBe(fn);
    });

    test('undefined values in objects are preserved', async () => {
      const val = signal<string | undefined>(undefined);
      const derived = reactive(() => ({ a: val.value, b: 'present' }));

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { a: string | undefined; b: string };
        return (
          <div data-testid="out">
            a={String(result.a)},b={result.b}
          </div>
        );
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('a=undefined,b=present');

      val.value = 'now defined';

      await expect.element(getByTestId('out')).toHaveTextContent('a=now defined,b=present');
    });

    test('object with keys added produces a new snapshot', async () => {
      const extra = signal(false);
      const derived = reactive(() => {
        const base: Record<string, unknown> = { a: 1 };
        if (extra.value) base.b = 2;
        return base;
      });

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        snapshots.push(result);
        return <div data-testid="out">{JSON.stringify(result)}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('{"a":1}');

      const first = snapshots[snapshots.length - 1];

      extra.value = true;

      await expect.element(getByTestId('out')).toHaveTextContent('{"a":1,"b":2}');

      const second = snapshots[snapshots.length - 1];
      expect(second).not.toBe(first);
      expect(Object.keys(second)).toEqual(['a', 'b']);
    });

    test('boolean values work correctly', async () => {
      const flag = signal(true);
      const derived = reactive(() => flag.value);

      function Component(): React.ReactNode {
        const result = useReactive(() => derived());
        return <div data-testid="out">{String(result)}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('true');

      flag.value = false;

      await expect.element(getByTestId('out')).toHaveTextContent('false');
    });

    test('mixed types in arrays are handled correctly', async () => {
      const date = new Date('2025-01-01');
      const val = signal('hello');
      const derived = reactive(() => [1, val.value, { nested: true }, date, null]);

      const snapshots: unknown[][] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as unknown[];
        snapshots.push(result);
        return <div data-testid="out">{result.map(String).join('|')}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent(`1|hello|[object Object]|${date.toString()}|null`);

      const first = snapshots[snapshots.length - 1];

      val.value = 'world';

      await expect.element(getByTestId('out')).toHaveTextContent(`1|world|[object Object]|${date.toString()}|null`);

      const second = snapshots[snapshots.length - 1];
      expect(second).not.toBe(first);
      // Unchanged nested object should keep same ref
      expect(second[2]).toBe(first[2]);
      // Date should keep same ref (class instance)
      expect(second[3]).toBe(first[3]);
    });
  });

  describe('deeply nested structural sharing', () => {
    test('only the changed path gets new refs through multiple levels', async () => {
      const deepVal = signal('original');
      const stableBranch = { x: { y: { z: 'stable' } } };
      const derived = reactive(() => ({
        branch1: stableBranch,
        branch2: {
          level2: {
            level3: deepVal.value,
          },
        },
      }));

      const snapshots: any[] = [];

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        snapshots.push(result);
        return (
          <div data-testid="out">
            {result.branch1.x.y.z},{result.branch2.level2.level3}
          </div>
        );
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('stable,original');

      const first = snapshots[snapshots.length - 1];

      deepVal.value = 'changed';

      await expect.element(getByTestId('out')).toHaveTextContent('stable,changed');

      const second = snapshots[snapshots.length - 1];

      // Top-level is new
      expect(second).not.toBe(first);
      // Stable branch is preserved entirely
      expect(second.branch1).toBe(first.branch1);
      expect(second.branch1.x).toBe(first.branch1.x);
      expect(second.branch1.x.y).toBe(first.branch1.x.y);
      // Changed branch gets new refs at every level along the path
      expect(second.branch2).not.toBe(first.branch2);
      expect(second.branch2.level2).not.toBe(first.branch2.level2);
    });
  });

  describe('rapid sequential updates', () => {
    test('multiple signal changes settle to final value', async () => {
      const val = signal(0);
      const derived = reactive(() => ({ count: val.value }));

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as { count: number };
        return <div data-testid="out">{result.count}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('0');

      val.value = 1;
      val.value = 2;
      val.value = 3;

      await expect.element(getByTestId('out')).toHaveTextContent('3');
    });
  });

  describe('ReactivePromise error state', () => {
    test('snapshot captures error and isRejected fields', async () => {
      const shouldFail = signal(true);
      const derived = reactive(async () => {
        const fail = shouldFail.value;
        await sleep(50);
        if (fail) throw new Error('boom');
        return 'ok';
      });

      let capturedResult: any;

      function Component(): React.ReactNode {
        const result = useReactive(() => derived()) as any;
        capturedResult = result;

        if (result.isPending && !result.isReady) return <div data-testid="out">Loading...</div>;
        if (result.isRejected) return <div data-testid="out">Error: {String(result.error)}</div>;
        return <div data-testid="out">{result.value}</div>;
      }

      const { getByTestId } = render(<Component />);

      await expect.element(getByTestId('out')).toHaveTextContent('Loading...');

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('Error:');
      expect(capturedResult.isRejected).toBe(true);
      expect(capturedResult.isSettled).toBe(true);
      expect(capturedResult.error).toBeInstanceOf(Error);

      shouldFail.value = false;

      await sleep(100);

      await expect.element(getByTestId('out')).toHaveTextContent('ok');
      expect(capturedResult.isRejected).toBe(false);
      expect(capturedResult.isResolved).toBe(true);
      expect(capturedResult.value).toBe('ok');
    });
  });

  describe('snapshot utility function directly', () => {
    test('primitives pass through', () => {
      expect(snapshot('hello', undefined)).toBe('hello');
      expect(snapshot(42, undefined)).toBe(42);
      expect(snapshot(true, undefined)).toBe(true);
      expect(snapshot(null, undefined)).toBe(null);
      expect(snapshot(undefined, undefined)).toBe(undefined);
    });

    test('plain object returns prev when structurally equal', () => {
      const prev = { a: 1, b: 'x' };
      const current = { a: 1, b: 'x' };
      expect(snapshot(current, prev)).toBe(prev);
    });

    test('plain object returns new when different', () => {
      const prev = { a: 1 };
      const current = { a: 2 };
      const result = snapshot(current, prev);
      expect(result).not.toBe(prev);
      expect(result).toEqual({ a: 2 });
    });

    test('array returns prev when structurally equal', () => {
      const prev = [1, 2, 3];
      const current = [1, 2, 3];
      expect(snapshot(current, prev)).toBe(prev);
    });

    test('array returns new when different', () => {
      const prev = [1, 2, 3];
      const current = [1, 2, 4];
      const result = snapshot(current, prev);
      expect(result).not.toBe(prev);
      expect(result).toEqual([1, 2, 4]);
    });

    test('nested structural sharing works', () => {
      const child = { deep: 'value' };
      const prev = { a: child, b: 'old' };
      const current = { a: { deep: 'value' }, b: 'new' };
      const result = snapshot(current, prev) as any;
      expect(result).not.toBe(prev);
      expect(result.a).toBe(prev.a);
      expect(result.b).toBe('new');
    });

    test('class instances are opaque leaves', () => {
      class Foo {
        x = 1;
      }
      const instance = new Foo();
      expect(snapshot(instance, undefined)).toBe(instance);
      expect(snapshot(instance, { x: 1 })).toBe(instance);
    });

    test('Map structural sharing', () => {
      const prev = new Map<string, unknown>([
        ['a', { x: 1 }],
        ['b', { x: 2 }],
      ]);
      const current = new Map<string, unknown>([
        ['a', { x: 1 }],
        ['b', { x: 3 }],
      ]);
      const result = snapshot(current, prev) as Map<string, unknown>;
      expect(result).not.toBe(prev);
      expect(result.get('a')).toBe(prev.get('a'));
      expect(result.get('b')).not.toBe(prev.get('b'));
      expect(result.get('b')).toEqual({ x: 3 });
    });

    test('Set returns prev when equal', () => {
      const prev = new Set([1, 2, 3]);
      const current = new Set([1, 2, 3]);
      expect(snapshot(current, prev)).toBe(prev);
    });

    test('Set returns new when different', () => {
      const prev = new Set([1, 2, 3]);
      const current = new Set([1, 2, 4]);
      expect(snapshot(current, prev)).not.toBe(prev);
    });
  });
});
