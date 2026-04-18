import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive, relay } from 'signalium';
import { useReactive } from 'signalium/react';
import React from 'react';
import { sleep } from '../../__tests__/utils/async.js';

describe('React > Relays', () => {
  test('relays can be set by values accessed outside of normal run loop ', async () => {
    const value = signal('Hello');

    const derived = reactive(() => {
      return relay<string>(state => {
        const run = async () => {
          await sleep(100);

          try {
            return `${value.value}, World`;
          } catch (e) {
            console.error(e);
            return 'Error';
          }
        };

        state.setPromise(run());
      });
    });

    function GrandChild({ text }: { text: string }): React.ReactNode {
      return <span>{text}</span>;
    }

    function Child({ asyncValue }: { asyncValue: { isPending: boolean; value: string | undefined } }): React.ReactNode {
      return <div>{asyncValue.isPending ? 'Loading...' : <GrandChild text={asyncValue.value!} />}</div>;
    }

    function Parent(): React.ReactNode {
      const d = useReactive(() => derived());
      return <Child asyncValue={d} />;
    }

    const { getByText } = render(<Parent />);

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();
  });
});
