import { describe, expect, test } from 'vitest';
import { context, getContext, withContexts, reactiveMethod, setScopeOwner } from '../index.js';

describe('setOwner', () => {
  test('maps an alternate owner object to a scope', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('default', 'label');

    class RegisteredOwner {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }

    class AliasedOwner {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }

    const registered = new RegisteredOwner();
    const alias = new AliasedOwner();

    withContexts(
      [
        [OwnerCtx, registered],
        [LabelCtx, 'owned'],
      ],
      () => {},
    );

    // Without mapping, calling alias.method would throw (no owner scope)
    expect(() => alias.method()).toThrow(
      'Object has no scope owner, reactiveMethod must be attached to an owned context object',
    );

    // Map alias -> registered so that alias resolves to registered's scope
    setScopeOwner(alias, registered);

    expect(alias.method()).toBe('owned');
  });

  test('chains mappings transitively (A -> B -> C)', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('label', 'label');

    class A {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }
    class B {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }
    class C {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }

    const a = new A();
    const b = new B();
    const c = new C();

    withContexts(
      [
        [OwnerCtx, c],
        [LabelCtx, 'C-scope'],
      ],
      () => {},
    );

    // Chain mappings A -> B and B -> C
    setScopeOwner(a, b);
    setScopeOwner(b, c);

    expect(a.method()).toBe('C-scope');
    expect(b.method()).toBe('C-scope');
    expect(c.method()).toBe('C-scope');
  });

  test('throws on conflicting rebind to a different owner', () => {
    const OwnerCtx = context<object | null>(null, 'owner');
    const LabelCtx = context('label', 'label');

    class A {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }
    class B {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }
    class C {
      method = reactiveMethod(this, () => getContext(LabelCtx));
    }

    const a = new A();
    const b = new B();
    const c1 = new C();
    const c2 = new C();

    // Register two distinct scopes
    withContexts(
      [
        [OwnerCtx, c1],
        [LabelCtx, 'C1'],
      ],
      () => {},
    );

    withContexts(
      [
        [OwnerCtx, c2],
        [LabelCtx, 'C2'],
      ],
      () => {},
    );

    // a currently maps (via b) to c1
    setScopeOwner(a, b);
    setScopeOwner(b, c1);
    expect(a.method()).toBe('C1');

    // Attempt to rebind a to a chain ending at c2 should throw
    expect(() => setScopeOwner(b, c2)).toThrow('Object already has a scope owner, owners cannot be dynamic');
  });
});
