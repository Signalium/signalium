import { describe, expect, test } from 'vitest';
import { context, getContext, withContexts, signal, reactiveMethod } from '../index.js';
import { nextTick, sleep } from './utils/async.js';

describe('reactiveMethod (async)', () => {
  test('basic async method resolves and uses owner scope across await', async () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('default', 'label');

    class Owner {
      method = reactiveMethod(this, async () => {
        const label = getContext(LabelCtx);
        await nextTick();
        return 'value-' + label;
      });
    }

    const owner = new Owner();

    // Register owner + label in a scope
    withContexts(
      [
        [OwnerCtx, owner],
        [LabelCtx, 'owned'],
      ],
      () => {},
    );

    const result1 = owner.method();
    expect(result1.isPending).toBe(true);
    expect(result1.value).toBe(undefined);
    await sleep(10);
    expect(result1.isResolved).toBe(true);
    expect(result1.value).toBe('value-owned');

    // Ambient override should not affect owner-scoped method
    const result2 = withContexts([[LabelCtx, 'other']], () => owner.method());
    await sleep(10);
    expect(result2.isResolved).toBe(true);
    expect(result2.value).toBe('value-owned');
  });

  test('async method caches per-args and recomputes when args change', async () => {
    let computeCount = 0;
    class Owner {
      sum = reactiveMethod(this, async (a: number, b: number) => {
        computeCount++;
        await nextTick();
        return a + b;
      });
    }

    const owner = new Owner();

    const OwnerCtx = context<object | null>(null, 'owner');
    withContexts([[OwnerCtx, owner]], () => {});

    const r1 = owner.sum(1, 2);
    await sleep(10);
    expect(r1.value).toBe(3);
    expect(computeCount).toBe(1);

    const r2 = owner.sum(1, 2);
    await sleep(10);
    expect(r2.value).toBe(3);
    expect(computeCount).toBe(1);

    const r3 = owner.sum(2, 2);
    await sleep(10);
    expect(r3.value).toBe(4);
    expect(computeCount).toBe(2);
  });

  test('async method recomputes when state used changes', async () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const count = signal(1);
    let computeCount = 0;
    class Owner {
      method = reactiveMethod(this, async (x: number) => {
        computeCount++;
        const c = count.value;
        await nextTick();
        return x + c;
      });
    }

    const owner = new Owner();
    withContexts([[OwnerCtx, owner]], () => {});

    const r1 = owner.method(1);
    await sleep(10);
    expect(r1.value).toBe(2);
    expect(computeCount).toBe(1);

    count.value = 2;
    const r2 = owner.method(1);
    expect(r2.isPending).toBe(true);
    await sleep(10);
    expect(r2.value).toBe(3);
    expect(computeCount).toBe(2);
  });

  test('different owners have independent async caches and contexts', async () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context(signal('default'), 'label');

    const labelA = signal('A');
    const labelB = signal('B');

    class Owner {
      constructor(public label: string) {}

      method = reactiveMethod(this, async () => {
        const label = getContext(LabelCtx).value;
        await nextTick();
        return label;
      });
    }

    const ownerA = new Owner('A');
    const ownerB = new Owner('B');

    // Register two separate owner scopes
    withContexts(
      [
        [OwnerCtx, ownerA],
        [LabelCtx, labelA],
      ],
      () => {},
    );

    withContexts(
      [
        [OwnerCtx, ownerB],
        [LabelCtx, labelB],
      ],
      () => {},
    );

    const rA1 = ownerA.method();
    const rB1 = ownerB.method();
    await sleep(10);
    expect(rA1.value).toBe('A');
    expect(rB1.value).toBe('B');

    labelA.value = 'AA';
    const rA2 = ownerA.method();
    await sleep(10);
    expect(rA2.value).toBe('AA');
    const rB2 = ownerB.method();
    await sleep(10);
    expect(rB2.value).toBe('B');
  });
});
