import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, ReactivePromise, relay } from 'signalium';
import { useReactive } from '../index.js';
import React, { memo } from 'react';
import { Locator } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';
import { createRenderCounter, HOC, RenderCounter } from './utils.js';
import component from '../component.js';

const PROMISE_PROPS: (keyof ReactivePromise<string>)[] = [
  'value',
  'error',
  'isPending',
  'isRejected',
  'isResolved',
  'isSettled',
  'isReady',
];

function createPromisePropCounter(prop: keyof ReactivePromise<string>, wrapper?: HOC) {
  return createRenderCounter(({ promise }: { promise: ReactivePromise<string> }) => {
    return <>{String(promise[prop])}</>;
  }, wrapper);
}

type PromisePropsKey = keyof ReactivePromise<string> | 'parent';

type PromisePropsRenderers = Record<PromisePropsKey, RenderCounter<{ promise: ReactivePromise<string> }>>;

export const createPromisePropsCounter = (
  propWrapper?: HOC,
  parentWrapper?: HOC,
): [RenderCounter<{ promise: ReactivePromise<string> }>, PromisePropsRenderers] => {
  const PropRenderers = PROMISE_PROPS.reduce((acc, prop) => {
    acc[prop] = createPromisePropCounter(prop, propWrapper);
    return acc;
  }, {} as PromisePropsRenderers);

  const ParentRenderer = createRenderCounter(({ promise }: { promise: ReactivePromise<string> }) => {
    return (
      <>
        {PROMISE_PROPS.map(prop => {
          const PropRenderer = PropRenderers[prop];

          return <PropRenderer key={String(prop)} promise={promise} />;
        })}
      </>
    );
  }, parentWrapper);

  PropRenderers.parent = ParentRenderer;

  return [ParentRenderer, PropRenderers];
};

const getPromiseValuesAndCounts = (
  getByTestId: (id: string | RegExp) => Locator,
  PropRenderers: PromisePropsRenderers,
) => {
  return Object.fromEntries(
    Object.entries(PropRenderers).map(([prop, renderer]) => {
      const value = getByTestId(renderer.testId.toString());

      return prop === 'parent'
        ? [prop, renderer.renderCount]
        : [prop, [value.element().textContent, renderer.renderCount]];
    }),
  );
};

describe('React > async', () => {
  describe('reactive functions', () => {
    test('results can be passed down to children and grandchildren, and are updated when reactive promise resolves', async () => {
      const value = signal('Hello');

      const derived = reactive(async () => {
        const v = value.value;
        await sleep(100);
        return `${v}, World`;
      });

      function GrandChild({ text }: { text: string }): React.ReactNode {
        return <span>{text}</span>;
      }

      function Child({
        asyncValue,
      }: {
        asyncValue: { isPending: boolean; value: string | undefined };
      }): React.ReactNode {
        return <div>{asyncValue.isPending ? 'Loading...' : <GrandChild text={asyncValue.value!} />}</div>;
      }

      function Parent(): React.ReactNode {
        const d = useReactive(derived);
        return <Child asyncValue={d} />;
      }

      const { getByText } = render(<Parent />);

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Hello, World')).toBeInTheDocument();

      value.value = 'Hey';

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Hey, World')).toBeInTheDocument();
    });

    test('results will update all promise props together when used in unmemoized functions', async () => {
      const content = signal('World');

      const derived1 = reactive(async () => {
        const v = `Hello, ${content.value}`;
        await sleep(100);
        return v;
      });

      const [ParentRenderer, Renderers] = createPromisePropsCounter();

      const Parent = () => <ParentRenderer promise={useReactive(derived1)} />;

      const { getByTestId } = render(<Parent />);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 1,

        isPending: ['true', 1],
        isReady: ['false', 1],
        isRejected: ['false', 1],
        isResolved: ['false', 1],
        isSettled: ['false', 1],
        value: ['undefined', 1],
        error: ['undefined', 1],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 2,

        isPending: ['false', 2],
        isReady: ['true', 2],
        isRejected: ['false', 2],
        isResolved: ['true', 2],
        isSettled: ['true', 2],
        value: ['Hello, World', 2],
        error: ['undefined', 2],
      });

      content.value = 'Galaxy';
      await sleep(0);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 3,

        isPending: ['true', 3],
        isReady: ['true', 3],
        isRejected: ['false', 3],
        isResolved: ['true', 3],
        isSettled: ['true', 3],
        value: ['Hello, World', 3],
        error: ['undefined', 3],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 4,

        isPending: ['false', 4],
        isReady: ['true', 4],
        isRejected: ['false', 4],
        isResolved: ['true', 4],
        isSettled: ['true', 4],
        value: ['Hello, Galaxy', 4],
        error: ['undefined', 4],
      });
    });

    test('it can transition back and forth between error and success states', async () => {
      const content = signal('World');

      const derived1 = reactive(async () => {
        const value = content.value;
        const v = `Hello, ${value}`;
        await sleep(100);
        if (value === 'Galaxy') {
          throw new Error('Galaxy is not allowed');
        }
        return v;
      });

      const [ParentRenderer, Renderers] = createPromisePropsCounter();

      const Parent = () => <ParentRenderer promise={useReactive(derived1)} />;

      const { getByTestId } = render(<Parent />);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 1,

        isPending: ['true', 1],
        isReady: ['false', 1],
        isRejected: ['false', 1],
        isResolved: ['false', 1],
        isSettled: ['false', 1],
        value: ['undefined', 1],
        error: ['undefined', 1],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 2,

        isPending: ['false', 2],
        isReady: ['true', 2],
        isRejected: ['false', 2],
        isResolved: ['true', 2],
        isSettled: ['true', 2],
        value: ['Hello, World', 2],
        error: ['undefined', 2],
      });

      content.value = 'Galaxy';
      await sleep(0);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 3,

        isPending: ['true', 3],
        isReady: ['true', 3],
        isRejected: ['false', 3],
        isResolved: ['true', 3],
        isSettled: ['true', 3],
        value: ['Hello, World', 3],
        error: ['undefined', 3],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 4,

        isPending: ['false', 4],
        isReady: ['true', 4],
        isRejected: ['true', 4],
        isResolved: ['false', 4],
        isSettled: ['true', 4],
        value: ['Hello, World', 4],
        error: ['Error: Galaxy is not allowed', 4],
      });

      content.value = 'Universe';
      await sleep(0);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 5,

        isPending: ['true', 5],
        isReady: ['true', 5],
        isRejected: ['true', 5],
        isResolved: ['false', 5],
        isSettled: ['true', 5],
        value: ['Hello, World', 5],
        error: ['Error: Galaxy is not allowed', 5],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 6,

        isPending: ['false', 6],
        isReady: ['true', 6],
        isRejected: ['false', 6],
        isResolved: ['true', 6],
        isSettled: ['true', 6],
        value: ['Hello, Universe', 6],
        error: ['undefined', 6],
      });
    });

    test('results can update independently from reactives when used in components', async () => {
      const value1 = signal('Hello');
      let parentRenderCount = 0;
      let childRenderCount = 0;

      const derived1 = reactive(async () => {
        const v = value1.value;
        await sleep(100);
        return v;
      });

      const Child = component(({ promise }: { promise: ReactivePromise<string> }): React.ReactNode => {
        childRenderCount++;
        return <span data-testid="child">{promise.value}</span>;
      });

      const Parent = component((): React.ReactNode => {
        parentRenderCount++;
        const d1 = derived1();
        return (
          <div data-testid="parent">
            <Child promise={d1} />
          </div>
        );
      });

      const { getByTestId } = render(<Parent />);

      // Wait for both promises to resolve
      await sleep(200);
      await expect.element(getByTestId('parent')).toBeInTheDocument();
      await expect.element(getByTestId('child')).toBeInTheDocument();

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(3);

      // Update only value1, should re-render only the child
      value1.value = 'World';
      await sleep(200);

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(4);
    });

    test('results do not update when used in React.memo components when passed down directly', async () => {
      const value1 = signal('Hello');
      let parentRenderCount = 0;
      let childRenderCount = 0;

      const derived1 = reactive(async () => {
        const v = value1.value;
        await sleep(100);
        return v;
      });

      const Child = memo(({ promise }: { promise: ReactivePromise<string> }): React.ReactNode => {
        childRenderCount++;
        return <span data-testid="child">{promise.value}</span>;
      });

      const Parent = memo((): React.ReactNode => {
        parentRenderCount++;
        const d1 = useReactive(derived1);
        return (
          <div data-testid="parent">
            <Child promise={d1} />
          </div>
        );
      });

      const { getByTestId } = render(<Parent />);

      // Wait for both promises to resolve
      await sleep(200);
      await expect.element(getByTestId('parent')).toBeInTheDocument();
      await expect.element(getByTestId('child')).toBeInTheDocument();

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(1);

      // Update only value1, should re-render only the child
      value1.value = 'World';
      await sleep(200);

      expect(parentRenderCount).toBe(4);
      expect(childRenderCount).toBe(1);
    });
  });

  describe('relays', () => {
    test('results can be passed down to children and grandchildren, and are updated when reactive promise resolves', async () => {
      const value = signal('Hello');

      const derived = reactive(() => {
        const greeting = value.value;

        return relay<string>(state => {
          const run = async () => {
            await sleep(100);

            return `${greeting}, World`;
          };

          state.setPromise(run());
        });
      });

      function GrandChild({ text }: { text: string }): React.ReactNode {
        return <span>{text}</span>;
      }

      function Child({
        asyncValue,
      }: {
        asyncValue: { isPending: boolean; value: string | undefined };
      }): React.ReactNode {
        return <div>{asyncValue.isPending ? 'Loading...' : <GrandChild text={asyncValue.value!} />}</div>;
      }

      function Parent(): React.ReactNode {
        const d = useReactive(derived);
        return <Child asyncValue={d} />;
      }

      const { getByText } = render(<Parent />);

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Hello, World')).toBeInTheDocument();

      value.value = 'Hey';

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Hey, World')).toBeInTheDocument();
    });

    test('results will update all promise props together when used in unmemoized functions', async () => {
      const content = signal('World');

      const derived1 = reactive(() => {
        return relay<string>(state => {
          const v = content.value;

          const run = async () => {
            await sleep(100);
            return `Hello, ${v}`;
          };

          state.setPromise(run());
        });
      });

      const [ParentRenderer, Renderers] = createPromisePropsCounter();

      const Parent = () => <ParentRenderer promise={useReactive(derived1)} />;

      const { getByTestId } = render(<Parent />);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 1,

        isPending: ['true', 1],
        isReady: ['false', 1],
        isRejected: ['false', 1],
        isResolved: ['false', 1],
        isSettled: ['false', 1],
        value: ['undefined', 1],
        error: ['undefined', 1],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 2,

        isPending: ['false', 2],
        isReady: ['true', 2],
        isRejected: ['false', 2],
        isResolved: ['true', 2],
        isSettled: ['true', 2],
        value: ['Hello, World', 2],
        error: ['undefined', 2],
      });

      content.value = 'Galaxy';
      // await sleep(10);

      // expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
      //   parent: 3,

      //   isPending: ['true', 3],
      //   isReady: ['true', 3],
      //   isRejected: ['false', 3],
      //   isResolved: ['true', 3],
      //   isSettled: ['true', 3],
      //   value: ['Hello, World', 3],
      //   error: ['undefined', 3],
      // });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 4,

        isPending: ['false', 4],
        isReady: ['true', 4],
        isRejected: ['false', 4],
        isResolved: ['true', 4],
        isSettled: ['true', 4],
        value: ['Hello, Galaxy', 4],
        error: ['undefined', 4],
      });
    });

    test('it can transition back and forth between error and success states', async () => {
      const content = signal('World');

      const derived1 = reactive(() => {
        return relay<string>(state => {
          const value = content.value;

          const run = async () => {
            await sleep(100);

            if (value === 'Galaxy') {
              throw new Error('Galaxy is not allowed');
            }

            return `Hello, ${value}`;
          };

          state.setPromise(run());
        });
      });

      const [ParentRenderer, Renderers] = createPromisePropsCounter();

      const Parent = () => <ParentRenderer promise={useReactive(derived1)} />;

      const { getByTestId } = render(<Parent />);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 1,

        isPending: ['true', 1],
        isReady: ['false', 1],
        isRejected: ['false', 1],
        isResolved: ['false', 1],
        isSettled: ['false', 1],
        value: ['undefined', 1],
        error: ['undefined', 1],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 2,

        isPending: ['false', 2],
        isReady: ['true', 2],
        isRejected: ['false', 2],
        isResolved: ['true', 2],
        isSettled: ['true', 2],
        value: ['Hello, World', 2],
        error: ['undefined', 2],
      });

      content.value = 'Galaxy';
      await sleep(0);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 3,

        isPending: ['true', 3],
        isReady: ['true', 3],
        isRejected: ['false', 3],
        isResolved: ['true', 3],
        isSettled: ['true', 3],
        value: ['Hello, World', 3],
        error: ['undefined', 3],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 4,

        isPending: ['false', 4],
        isReady: ['true', 4],
        isRejected: ['true', 4],
        isResolved: ['false', 4],
        isSettled: ['true', 4],
        value: ['Hello, World', 4],
        error: ['Error: Galaxy is not allowed', 4],
      });

      content.value = 'Universe';
      await sleep(0);

      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 5,

        isPending: ['true', 5],
        isReady: ['true', 5],
        isRejected: ['true', 5],
        isResolved: ['false', 5],
        isSettled: ['true', 5],
        value: ['Hello, World', 5],
        error: ['Error: Galaxy is not allowed', 5],
      });

      await sleep(200);
      expect(getPromiseValuesAndCounts(getByTestId, Renderers)).toEqual({
        parent: 6,

        isPending: ['false', 6],
        isReady: ['true', 6],
        isRejected: ['false', 6],
        isResolved: ['true', 6],
        isSettled: ['true', 6],
        value: ['Hello, Universe', 6],
        error: ['undefined', 6],
      });
    });

    test('results can update when used in components', async () => {
      const value1 = signal('Hello');
      let parentRenderCount = 0;
      let childRenderCount = 0;

      const derived1 = reactive(() => {
        return relay<string>(state => {
          const v = value1.value;

          const run = async () => {
            await sleep(100);
            return v;
          };

          state.setPromise(run());
        });
      });

      const Child = component(({ promise }: { promise: AsyncSignal<string> }): React.ReactNode => {
        childRenderCount++;
        return <span data-testid="child">{promise.value}</span>;
      });

      const Parent = component((): React.ReactNode => {
        parentRenderCount++;
        const d1 = useReactive(derived1);
        return (
          <div data-testid="parent">
            <Child promise={d1} />
          </div>
        );
      });

      const { getByTestId } = render(<Parent />);

      // Wait for both promises to resolve
      await sleep(200);
      await expect.element(getByTestId('parent')).toBeInTheDocument();
      await expect.element(getByTestId('child')).toBeInTheDocument();

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(3);

      // Update only value1, should re-render only the child
      value1.value = 'World';
      await sleep(200);

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(4);
    });

    test('results do not update when used in React.memo components when passed down directly', async () => {
      const value1 = signal('Hello');
      let parentRenderCount = 0;
      let childRenderCount = 0;

      const derived1 = reactive(() => {
        return relay<string>(state => {
          const v = value1.value;

          const run = async () => {
            await sleep(100);
            return v;
          };

          state.setPromise(run());
        });
      });

      const Child = memo(({ promise }: { promise: ReactivePromise<string> }): React.ReactNode => {
        childRenderCount++;
        return <span data-testid="child">{promise.value}</span>;
      });

      const Parent = memo((): React.ReactNode => {
        parentRenderCount++;
        const d1 = useReactive(derived1);
        return (
          <div data-testid="parent">
            <Child promise={d1} />
          </div>
        );
      });

      const { getByTestId } = render(<Parent />);

      // Wait for both promises to resolve
      await sleep(200);
      await expect.element(getByTestId('parent')).toBeInTheDocument();
      await expect.element(getByTestId('child')).toBeInTheDocument();

      expect(parentRenderCount).toBe(2);
      expect(childRenderCount).toBe(1);

      // Update only value1, should re-render only the child
      value1.value = 'World';
      await sleep(200);

      expect(parentRenderCount).toBe(4);
      expect(childRenderCount).toBe(1);
    });
  });
});
