import { describe, expect, test } from 'vitest';
import { context, withContexts, getContext, reactiveMethod } from 'signalium';

describe('reactiveMethod', () => {
  test('uses the owner scope rather than the ambient scope', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('default', 'label');

    // Establish an owner scope that maps the owner object and provides a label
    class Owner {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }

    const owner = new Owner();

    withContexts(
      [
        [OwnerCtx, owner],
        [LabelCtx, 'owned'],
      ],
      () => {},
    );

    // Called in global/ambient scope – should still use the owner's scope
    expect(owner.method()).toBe('owned');

    // Called inside a different ambient scope – should still use the owner's scope
    const resultInOtherScope = withContexts([[LabelCtx, 'other']], () => owner.method());
    expect(resultInOtherScope).toBe('owned');
  });

  test('throws if called for an owner with no associated scope', () => {
    class Owner {
      method = reactiveMethod(this, () => 123);
    }

    const owner = new Owner();

    expect(() => owner.method()).toThrow(
      'Object has no scope owner, reactiveMethod must be attached to an owned context object',
    );
  });

  test('caches like a standard reactive function (per owner, per args)', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('X', 'label');

    let computeCount = 0;
    class Owner {
      method = reactiveMethod(this, (a: number, b: number) => {
        computeCount++;
        return `${getContext(LabelCtx)}:${a + b}`;
      });
    }

    const owner = new Owner();

    withContexts(
      [
        [OwnerCtx, owner],
        [LabelCtx, 'X'],
      ],
      () => {},
    );

    expect(owner.method(1, 2)).toBe('X:3');
    expect(computeCount).toBe(1);

    // Same args -> cached
    expect(owner.method(1, 2)).toBe('X:3');
    expect(computeCount).toBe(1);

    // Different args -> recomputed
    expect(owner.method(2, 2)).toBe('X:4');
    expect(computeCount).toBe(2);
  });

  test('different owners have independent scopes and caches', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('default', 'label');

    class Owner {
      constructor(public label: string) {}

      count = 0;
      method = reactiveMethod(this, (x: number) => {
        this.count++;
        return `${getContext(LabelCtx)}:${x}`;
      });
    }

    const ownerA = new Owner('A');
    const ownerB = new Owner('B');

    // Establish owner A scope
    withContexts(
      [
        [OwnerCtx, ownerA],
        [LabelCtx, 'A'],
      ],
      () => {},
    );

    // Establish owner B scope
    withContexts(
      [
        [OwnerCtx, ownerB],
        [LabelCtx, 'B'],
      ],
      () => {},
    );

    // Initial calls compute once per owner
    expect(ownerA.method(1)).toBe('A:1');
    expect(ownerB.method(1)).toBe('B:1');
    expect(ownerA.count).toBe(1);
    expect(ownerB.count).toBe(1);

    // Repeat with same args -> cached independently
    expect(ownerA.method(1)).toBe('A:1');
    expect(ownerB.method(1)).toBe('B:1');
    expect(ownerA.count).toBe(1);
    expect(ownerB.count).toBe(1);

    // Change args per owner -> recompute per owner only
    expect(ownerA.method(2)).toBe('A:2');
    expect(ownerB.method(3)).toBe('B:3');
    expect(ownerA.count).toBe(2);
    expect(ownerB.count).toBe(2);

    // Ambient override should not affect owner-scoped method
    const inOther = withContexts([[LabelCtx, 'Z']], () => [ownerA.method(2), ownerB.method(3)]);
    expect(inOther[0]).toBe('A:2');
    expect(inOther[1]).toBe('B:3');
  });
});
