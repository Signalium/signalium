import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React from 'react';

import { context, signal, reactive } from '../../index.js';
import { reactiveMethod } from 'signalium';
import { ContextProvider, useReactive, useContext } from '../index.js';

describe('React > reactiveMethod', () => {
  test('uses owner scope even when ambient scope differs', async () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('default', 'label');

    class Owner {
      method = reactiveMethod(this, () => useContext(LabelCtx));
    }

    const owner = new Owner();
    const derived = reactive(() => owner.method());

    const Derived = () => {
      const value = useReactive(derived);
      return <div data-testid="value">{value}</div>;
    };

    const App = () => (
      <ContextProvider
        contexts={[
          [OwnerCtx, owner],
          [LabelCtx, 'owned'],
        ]}
      >
        {/* Ambient override should not affect the method bound to owner */}
        <ContextProvider contexts={[[LabelCtx, 'other']]}>
          <Derived />
        </ContextProvider>
      </ContextProvider>
    );

    const { getByTestId } = render(<App />);
    await expect.element(getByTestId('value')).toHaveTextContent('owned');
  });

  test('different owners compute independently and update reactively', async () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context(signal('default'), 'label');

    const labelA = signal('A');
    const labelB = signal('B');

    class Owner {
      value = reactiveMethod(this, () => useContext(LabelCtx).value);
    }

    const ownerA = new Owner();
    const ownerB = new Owner();
    const derivedA = reactive(() => ownerA.value());
    const derivedB = reactive(() => ownerB.value());

    const View = ({ id, method }: { id: string; method: () => string }) => {
      const value = useReactive(method === ownerA.value ? derivedA : derivedB);
      return <div data-testid={id}>{value}</div>;
    };

    const { getByTestId } = render(
      <>
        <ContextProvider
          contexts={[
            [OwnerCtx, ownerA],
            [LabelCtx, labelA],
          ]}
        >
          <View id="a" method={ownerA.value} />
        </ContextProvider>
        <ContextProvider
          contexts={[
            [OwnerCtx, ownerB],
            [LabelCtx, labelB],
          ]}
        >
          <View id="b" method={ownerB.value} />
        </ContextProvider>
      </>,
    );

    await expect.element(getByTestId('a')).toHaveTextContent('A');
    await expect.element(getByTestId('b')).toHaveTextContent('B');

    labelA.value = 'AA';
    await expect.element(getByTestId('a')).toHaveTextContent('AA');
    await expect.element(getByTestId('b')).toHaveTextContent('B');

    labelB.value = 'BB';
    await expect.element(getByTestId('a')).toHaveTextContent('AA');
    await expect.element(getByTestId('b')).toHaveTextContent('BB');
  });
});
