import { describe, expect, test } from 'vitest';
import { snapshot, registerCustomSnapshot } from 'signalium/utils';

describe('snapshot', () => {
  describe('primitives and pass-through', () => {
    test('returns primitives unchanged', () => {
      expect(snapshot(undefined, undefined)).toBe(undefined);
      expect(snapshot(null, null)).toBe(null);
      expect(snapshot(42, 0)).toBe(42);
      expect(snapshot('hi', 'hi')).toBe('hi');
      expect(snapshot(true, false)).toBe(true);
    });

    test('plain objects are deep-cloned with structural sharing', () => {
      const prev = { a: 1, nested: { b: 2 } };
      const current = { a: 1, nested: prev.nested };
      const result = snapshot(current, prev) as typeof prev;

      expect(result).toEqual({ a: 1, nested: { b: 2 } });
      expect(result.nested).toBe(prev.nested);
    });

    test('unregistered class instances are returned as-is', () => {
      class Plain {
        constructor(public x: number) {}
      }
      const value = new Plain(1);
      expect(snapshot(value, undefined)).toBe(value);
    });
  });

  describe('registerCustomSnapshot — direct match', () => {
    test('handler is called for instances of the registered class', () => {
      class Counter {
        constructor(public count: number) {}
      }
      registerCustomSnapshot(Counter, current => ({ count: current.count }) as any);

      const result = snapshot(new Counter(7), undefined) as { count: number };
      expect(result).toEqual({ count: 7 });
      expect(result).not.toBeInstanceOf(Counter);
    });

    test('handler returning prev preserves reference stability', () => {
      class Box {
        constructor(public value: number) {}
      }
      registerCustomSnapshot(Box, (current, prev) => {
        if (prev && current.value === (prev as any).value) return prev;
        return { value: current.value } as any;
      });

      const prev = { value: 5 };
      const result = snapshot(new Box(5), prev);
      expect(result).toBe(prev);
    });
  });

  describe('registerCustomSnapshot — prototype-chain walk for subclasses', () => {
    test('subclass inherits the parent class handler', () => {
      class Base {
        constructor(public name: string) {}
      }
      registerCustomSnapshot(Base, current => ({ name: (current as Base).name, kind: 'snapshot' }) as any);

      class Child extends Base {
        constructor(
          name: string,
          public extra: number,
        ) {
          super(name);
        }
      }

      const child = new Child('alice', 99);
      const result = snapshot(child, undefined) as { name: string; kind: string };
      expect(result).toEqual({ name: 'alice', kind: 'snapshot' });
      expect(result).not.toBe(child);
    });

    test('grandchild inherits handler through multiple levels', () => {
      class A {
        constructor(public n: number) {}
      }
      registerCustomSnapshot(A, current => ({ from: 'A', n: (current as A).n }) as any);

      class B extends A {}
      class C extends B {}

      const result = snapshot(new C(3), undefined) as { from: string; n: number };
      expect(result).toEqual({ from: 'A', n: 3 });
    });

    test('subclass-registered handler overrides parent handler', () => {
      class Animal {
        constructor(public name: string) {}
      }
      registerCustomSnapshot(Animal, current => ({ tag: 'animal', name: (current as Animal).name }) as any);

      class Dog extends Animal {
        constructor(
          name: string,
          public breed: string,
        ) {
          super(name);
        }
      }
      registerCustomSnapshot(
        Dog,
        current => ({ tag: 'dog', name: (current as Dog).name, breed: (current as Dog).breed }) as any,
      );

      const dog = snapshot(new Dog('rex', 'pug'), undefined) as { tag: string; name: string; breed: string };
      expect(dog).toEqual({ tag: 'dog', name: 'rex', breed: 'pug' });

      // The base class still uses its own handler.
      const animal = snapshot(new Animal('whiskers'), undefined) as { tag: string; name: string };
      expect(animal).toEqual({ tag: 'animal', name: 'whiskers' });
    });

    test('parent handler can recurse into the actual instance via the snap fn', () => {
      class Container {
        constructor(public items: Array<{ id: number; label: string }>) {}
      }
      registerCustomSnapshot(Container, (current, prev, snap) => {
        const items = snap((current as Container).items, (prev as any)?.items) as Array<{
          id: number;
          label: string;
        }>;
        if (prev && items === (prev as any).items) return prev;
        return { items } as any;
      });

      class TaggedContainer extends Container {}

      const prev = snapshot(
        new TaggedContainer([
          { id: 1, label: 'a' },
          { id: 2, label: 'b' },
        ]),
        undefined,
      ) as { items: Array<{ id: number; label: string }> };

      const next = snapshot(
        new TaggedContainer([
          { id: 1, label: 'a' },
          { id: 2, label: 'B' },
        ]),
        prev,
      ) as { items: Array<{ id: number; label: string }> };

      // Item 0 is unchanged → reference shared.
      expect(next.items[0]).toBe(prev.items[0]);
      // Item 1 changed → new reference.
      expect(next.items[1]).not.toBe(prev.items[1]);
      expect(next.items[1]).toEqual({ id: 2, label: 'B' });
    });

    test('ancestor registered after the subclass is defined still applies to subclass instances', () => {
      // Subclass has been snapshotted (and returned as-is) before any
      // registration exists anywhere in the chain. Once we register on the
      // ancestor, the next snapshot must pick up the new handler.
      class LateBase {
        constructor(public v: number) {}
      }
      class LateChild extends LateBase {}

      const beforeRegister = snapshot(new LateChild(1), undefined);
      expect(beforeRegister).toBeInstanceOf(LateChild);

      registerCustomSnapshot(LateBase, current => ({ v: (current as LateBase).v }) as any);

      const afterRegister = snapshot(new LateChild(2), undefined);
      expect(afterRegister).toEqual({ v: 2 });
      expect(afterRegister).not.toBeInstanceOf(LateChild);
    });
  });

  describe('built-in handlers are not inherited by subclasses', () => {
    // The plain-object / Array / Map / Set handlers are intentionally matched
    // by exact prototype only. This preserves the historical behavior where
    // a class instance with no custom registration is returned as-is, even
    // when its base is a built-in container type.

    test('subclass of Array without a custom registration is returned as-is', () => {
      class MyArray extends Array<number> {}
      const arr = new MyArray();
      arr.push(1, 2, 3);
      expect(snapshot(arr, undefined)).toBe(arr);
    });

    test('subclass of Map without a custom registration is returned as-is', () => {
      class MyMap extends Map<string, number> {}
      const m = new MyMap();
      m.set('a', 1);
      expect(snapshot(m, undefined)).toBe(m);
    });

    test('plain objects still use the built-in handler', () => {
      const obj = { a: 1, b: 2 };
      const result = snapshot(obj, undefined) as typeof obj;
      expect(result).toEqual(obj);
      expect(result).not.toBe(obj);
    });
  });
});
