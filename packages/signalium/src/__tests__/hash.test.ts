import { describe, expect, test } from 'vitest';
import { hashValue, registerCustomHash } from 'signalium/utils';
import { hashReactiveFn } from '../internals/utils/hash.js';

describe('hashValue', () => {
  describe('basic types', () => {
    test('undefined is deterministic', () => {
      expect(hashValue(undefined)).toBe(hashValue(undefined));
    });

    test('null is deterministic', () => {
      expect(hashValue(null)).toBe(hashValue(null));
    });

    test('booleans are deterministic and distinct', () => {
      expect(hashValue(true)).toBe(hashValue(true));
      expect(hashValue(false)).toBe(hashValue(false));
      expect(hashValue(true)).not.toBe(hashValue(false));
    });

    test('numbers are deterministic', () => {
      expect(hashValue(42)).toBe(hashValue(42));
    });

    test('different numbers produce different hashes', () => {
      expect(hashValue(1)).not.toBe(hashValue(2));
    });

    test('negative and positive numbers are distinct', () => {
      expect(hashValue(-1)).not.toBe(hashValue(1));
    });

    test('string and number with same characters are distinct', () => {
      expect(hashValue('1')).not.toBe(hashValue(1));
      expect(hashValue('true')).not.toBe(hashValue(true));
    });

    test('NaN is deterministic', () => {
      expect(hashValue(NaN)).toBe(hashValue(NaN));
    });

    test('Infinity and -Infinity are distinct', () => {
      expect(hashValue(Infinity)).toBe(hashValue(Infinity));
      expect(hashValue(-Infinity)).toBe(hashValue(-Infinity));
      expect(hashValue(Infinity)).not.toBe(hashValue(-Infinity));
    });

    // -0 and 0 are indistinguishable via String(), so they hash the same.
    // This is a known JS behavior: String(-0) === String(0) === "0".
    test('-0 and 0 hash the same (String coercion)', () => {
      expect(hashValue(-0)).toBe(hashValue(0));
    });

    test('bigint is deterministic', () => {
      expect(hashValue(1n)).toBe(hashValue(1n));
    });

    test('different bigints are distinct', () => {
      expect(hashValue(1n)).not.toBe(hashValue(2n));
    });

    test('bigint and number with same value are distinct', () => {
      expect(hashValue(1n)).not.toBe(hashValue(1));
    });

    // All distinct falsy values should hash differently from each other
    test('distinct falsy values are all distinct', () => {
      const falsy = [undefined, null, false, 0, ''];
      const hashes = falsy.map(v => hashValue(v));
      const unique = new Set(hashes);
      expect(unique.size).toBe(falsy.length);
    });
  });

  describe('type discrimination', () => {
    // The hash seeds ensure that structurally similar values of different types
    // produce different hashes.
    test('empty collections of different types are all distinct', () => {
      const hashes = [hashValue([]), hashValue({}), hashValue(new Map()), hashValue(new Set())];
      const unique = new Set(hashes);
      expect(unique.size).toBe(4);
    });

    test('Map with entries hashes differently from equivalent Object', () => {
      expect(hashValue(new Map([['a', 1]]))).not.toBe(hashValue({ a: 1 }));
    });

    test('Set hashes differently from Array with same values', () => {
      expect(hashValue(new Set([1, 2, 3]))).not.toBe(hashValue([1, 2, 3]));
    });
  });

  describe('objects', () => {
    test('plain objects are deterministic', () => {
      expect(hashValue({ a: 1 })).toBe(hashValue({ a: 1 }));
    });

    test('objects with different values are distinct', () => {
      expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    });

    test('objects are key-order independent', () => {
      expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
    });

    // Validates the imul(key, 0x9e3779b9) ^ value fix: with plain XOR, swapping
    // which key maps to which value could produce the same hash.
    test('swapping values across keys produces a different hash', () => {
      expect(hashValue({ a: 1, b: 2 })).not.toBe(hashValue({ a: 2, b: 1 }));
    });

    test('nested objects are deterministic', () => {
      expect(hashValue({ a: { b: { c: 1 } } })).toBe(hashValue({ a: { b: { c: 1 } } }));
    });

    test('nested objects with different deep values are distinct', () => {
      expect(hashValue({ a: { b: { c: 1 } } })).not.toBe(hashValue({ a: { b: { c: 2 } } }));
    });

    // Objects with null prototype fall through to reference-based hashing since
    // null is not in PROTO_TO_HASH. Two structurally identical null-proto objects
    // are NOT structurally equal — each gets its own identity hash.
    test('null-prototype objects use reference identity, not structural equality', () => {
      const a = Object.create(null) as Record<string, unknown>;
      const b = Object.create(null) as Record<string, unknown>;
      a.x = 1;
      b.x = 1;
      expect(hashValue(a)).toBe(hashValue(a));
      expect(hashValue(a)).not.toBe(hashValue(b));
    });
  });

  describe('arrays', () => {
    test('arrays are deterministic', () => {
      expect(hashValue([1, 2, 3])).toBe(hashValue([1, 2, 3]));
    });

    test('arrays are order-sensitive', () => {
      expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
    });

    test('arrays of objects are structural', () => {
      expect(hashValue([{ a: 1 }, { b: 2 }])).toBe(hashValue([{ a: 1 }, { b: 2 }]));
    });

    test('arrays of objects with different values are distinct', () => {
      expect(hashValue([{ a: 1 }])).not.toBe(hashValue([{ a: 2 }]));
    });
  });

  describe('maps', () => {
    test('maps are deterministic', () => {
      expect(hashValue(new Map([['a', 1]]))).toBe(hashValue(new Map([['a', 1]])));
    });

    test('maps with different values are distinct', () => {
      expect(hashValue(new Map([['a', 1]]))).not.toBe(hashValue(new Map([['a', 2]])));
    });

    test('maps are key-order independent', () => {
      expect(
        hashValue(
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
        ),
      ).toBe(
        hashValue(
          new Map([
            ['b', 2],
            ['a', 1],
          ]),
        ),
      );
    });

    test('swapping values across keys produces a different hash', () => {
      expect(
        hashValue(
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
        ),
      ).not.toBe(
        hashValue(
          new Map([
            ['a', 2],
            ['b', 1],
          ]),
        ),
      );
    });
  });

  describe('sets', () => {
    test('sets are deterministic', () => {
      expect(hashValue(new Set([1, 2, 3]))).toBe(hashValue(new Set([1, 2, 3])));
    });

    test('sets with different values are distinct', () => {
      expect(hashValue(new Set([1, 2]))).not.toBe(hashValue(new Set([1, 3])));
    });

    test('sets are insertion-order independent', () => {
      expect(hashValue(new Set([1, 2, 3]))).toBe(hashValue(new Set([3, 1, 2])));
    });
  });

  describe('dates', () => {
    test('same date is deterministic', () => {
      expect(hashValue(new Date(1000))).toBe(hashValue(new Date(1000)));
    });

    test('different dates are distinct', () => {
      expect(hashValue(new Date(1000))).not.toBe(hashValue(new Date(2000)));
    });

    test('pre-epoch and post-epoch dates with same magnitude are distinct', () => {
      expect(hashValue(new Date(-1000))).not.toBe(hashValue(new Date(1000)));
    });
  });

  describe('regexps', () => {
    test('same regexp is deterministic', () => {
      expect(hashValue(/abc/)).toBe(hashValue(/abc/));
    });

    test('different patterns are distinct', () => {
      expect(hashValue(/abc/)).not.toBe(hashValue(/xyz/));
    });

    test('same pattern with different flags are distinct', () => {
      expect(hashValue(/abc/g)).not.toBe(hashValue(/abc/i));
    });

    test('regexp and string with same source are distinct', () => {
      expect(hashValue(/abc/)).not.toBe(hashValue('abc'));
    });
  });

  describe('functions and reference identity', () => {
    test('same function reference always hashes the same', () => {
      const fn = () => {};
      expect(hashValue(fn)).toBe(hashValue(fn));
    });

    test('two different functions hash differently', () => {
      const fn1 = () => {};
      const fn2 = () => {};
      expect(hashValue(fn1)).not.toBe(hashValue(fn2));
    });

    test('class instances with unknown prototype use reference identity', () => {
      class Foo {
        x = 1;
      }
      const a = new Foo();
      const b = new Foo();
      expect(hashValue(a)).toBe(hashValue(a));
      expect(hashValue(a)).not.toBe(hashValue(b));
    });
  });

  describe('unicode strings', () => {
    // hashStr previously truncated each char to & 0xff, causing characters that
    // share a low byte (e.g. '\x01' = U+0001 and 'ā' = U+0101) to collide.
    // It now uses & 0xffff to preserve the full UTF-16 code unit.

    test('characters with the same low byte but different high byte are distinct', () => {
      // '\x01' = U+0001, 'ā' = U+0101 — both have low byte 0x01
      expect(hashValue('\x01')).not.toBe(hashValue('\u0101'));
    });

    test('two-character strings differing only in high bytes are distinct', () => {
      expect(hashValue('\x01\x02')).not.toBe(hashValue('\u0101\u0202'));
    });

    test('non-ASCII strings are deterministic', () => {
      expect(hashValue('αβγ')).toBe(hashValue('αβγ'));
    });

    test('non-ASCII strings with different characters are distinct', () => {
      expect(hashValue('αβγ')).not.toBe(hashValue('αβδ'));
    });
  });

  describe('large number hashing (hashNumber multi-chunk)', () => {
    // hashNumber previously computed numBytes from the post-loop remainder
    // instead of the original value. These tests verify correct behavior
    // for numbers that cross the 32-bit boundary (>= 0xffffffff).

    test('timestamp crossing the 32-bit boundary hashes correctly', () => {
      // 0xffffffff ms ≈ year 2106, 0x100000000 is one ms later
      expect(hashValue(new Date(0xffffffff))).not.toBe(hashValue(new Date(0x100000000)));
    });

    test('large timestamps are deterministic', () => {
      expect(hashValue(new Date(0x100000000))).toBe(hashValue(new Date(0x100000000)));
    });

    test('negative large timestamp is distinct from positive', () => {
      expect(hashValue(new Date(-0x100000000))).not.toBe(hashValue(new Date(0x100000000)));
    });
  });

  describe('hashReactiveFn', () => {
    test('same function and same args produce the same hash', () => {
      const fn = () => {};
      expect(hashReactiveFn(fn, [1, 2])).toBe(hashReactiveFn(fn, [1, 2]));
    });

    test('same function with no args is deterministic', () => {
      const fn = () => {};
      expect(hashReactiveFn(fn, [])).toBe(hashReactiveFn(fn, []));
    });

    test('different functions with same args produce different hashes', () => {
      const fn1 = () => {};
      const fn2 = () => {};
      expect(hashReactiveFn(fn1, [1])).not.toBe(hashReactiveFn(fn2, [1]));
    });

    test('same function with different args produces different hashes', () => {
      const fn = () => {};
      expect(hashReactiveFn(fn, [1])).not.toBe(hashReactiveFn(fn, [2]));
    });

    test('args are order-sensitive', () => {
      const fn = () => {};
      expect(hashReactiveFn(fn, [1, 2])).not.toBe(hashReactiveFn(fn, [2, 1]));
    });

    test('empty args and non-empty args are distinct', () => {
      const fn = () => {};
      expect(hashReactiveFn(fn, [])).not.toBe(hashReactiveFn(fn, [1]));
    });
  });

  describe('custom hash registration', () => {
    test('registered class with constructor args uses custom hash function', () => {
      class Point {
        constructor(
          public x: number,
          public y: number,
        ) {}
      }
      registerCustomHash(Point, p => p.x * 31 + p.y);

      const p1a = new Point(1, 2);
      const p1b = new Point(1, 2);
      const p2 = new Point(3, 4);

      expect(hashValue(p1a)).toBe(hashValue(p1b));
      expect(hashValue(p1a)).not.toBe(hashValue(p2));
    });
  });

  describe('output stability', () => {
    // Snapshot tests pin the exact hash output so any change to the hash
    // algorithm — intentional or not — is immediately visible in the diff.
    // Update snapshots intentionally with: vitest --update-snapshots

    test('primitive values', () => {
      expect(hashValue(undefined)).toMatchInlineSnapshot(`2646103602`);
      expect(hashValue(null)).toMatchInlineSnapshot(`3253525531`);
      expect(hashValue(true)).toMatchInlineSnapshot(`735103117`);
      expect(hashValue(false)).toMatchInlineSnapshot(`3591532386`);
      expect(hashValue(0)).toMatchInlineSnapshot(`2501428053`);
      expect(hashValue(1)).toMatchInlineSnapshot(`3948817156`);
      expect(hashValue(-1)).toMatchInlineSnapshot(`3342378546`);
      expect(hashValue(42)).toMatchInlineSnapshot(`2309378637`);
      expect(hashValue(NaN)).toMatchInlineSnapshot(`1894338524`);
      expect(hashValue(Infinity)).toMatchInlineSnapshot(`371804219`);
      expect(hashValue(-Infinity)).toMatchInlineSnapshot(`1583457425`);
      expect(hashValue(1n)).toMatchInlineSnapshot(`3501201481`);
    });

    test('strings', () => {
      expect(hashValue('')).toMatchInlineSnapshot(`3423425485`);
      expect(hashValue('a')).toMatchInlineSnapshot(`2383563902`);
      expect(hashValue('hello')).toMatchInlineSnapshot(`3162722260`);
      expect(hashValue('hello world')).toMatchInlineSnapshot(`2176277822`);
      // Unicode — validates the & 0xffff fix is stable
      expect(hashValue('\u0101')).toMatchInlineSnapshot(`3225883467`);
      expect(hashValue('αβγ')).toMatchInlineSnapshot(`3984487803`);
      expect(hashValue('🎉')).toMatchInlineSnapshot(`2207496472`);
    });

    test('objects', () => {
      expect(hashValue({})).toMatchInlineSnapshot(`3137198987`);
      expect(hashValue({ a: 1 })).toMatchInlineSnapshot(`707451285`);
      expect(hashValue({ a: 1, b: 2 })).toMatchInlineSnapshot(`861414914`);
      expect(hashValue({ a: { b: { c: 1 } } })).toMatchInlineSnapshot(`2964177714`);
    });

    test('arrays', () => {
      expect(hashValue([])).toMatchInlineSnapshot(`725703326`);
      expect(hashValue([1])).toMatchInlineSnapshot(`2486031430`);
      expect(hashValue([1, 2, 3])).toMatchInlineSnapshot(`268952837`);
      expect(hashValue([{ a: 1 }, { b: 2 }])).toMatchInlineSnapshot(`4025830795`);
    });

    test('maps and sets', () => {
      expect(hashValue(new Map())).toMatchInlineSnapshot(`2090287741`);
      expect(hashValue(new Map([['a', 1]]))).toMatchInlineSnapshot(`3955507335`);
      expect(hashValue(new Set())).toMatchInlineSnapshot(`2375664817`);
      expect(hashValue(new Set([1, 2, 3]))).toMatchInlineSnapshot(`831291329`);
    });

    test('dates and regexps', () => {
      expect(hashValue(new Date(0))).toMatchInlineSnapshot(`3424311365`);
      expect(hashValue(new Date(1000))).toMatchInlineSnapshot(`1685010277`);
      expect(hashValue(new Date(-1000))).toMatchInlineSnapshot(`912923340`);
      expect(hashValue(/abc/)).toMatchInlineSnapshot(`3426973360`);
      expect(hashValue(/abc/gi)).toMatchInlineSnapshot(`845599925`);
    });
  });

  describe('cycle detection', () => {
    test('self-referential object does not stack overflow', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(() => hashValue(obj)).not.toThrow();
    });

    test('self-referential object is deterministic', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(hashValue(obj)).toBe(hashValue(obj));
    });

    test('mutually referential objects do not stack overflow', () => {
      const a: Record<string, unknown> = {};
      const b: Record<string, unknown> = { ref: a };
      a.ref = b;
      expect(() => hashValue(a)).not.toThrow();
    });

    test('self-referential array does not stack overflow', () => {
      const arr: unknown[] = [];
      arr.push(arr);
      expect(() => hashValue(arr)).not.toThrow();
    });

    test('self-referential array is deterministic', () => {
      const arr: unknown[] = [];
      arr.push(arr);
      expect(hashValue(arr)).toBe(hashValue(arr));
    });

    // This tests that seen.pop() correctly restores state between siblings.
    // If the node is not popped, the second reference to `shared` would be
    // treated as a cycle even though it isn't.
    test('sibling references to the same object are not treated as cycles', () => {
      const shared = { x: 1 };
      const withSiblings = { a: shared, b: shared };
      const withoutSiblings = { a: shared, b: { x: 1 } };
      expect(() => hashValue(withSiblings)).not.toThrow();
      expect(hashValue(withSiblings)).toBe(hashValue(withoutSiblings));
    });

    test('cycle inside an array does not stack overflow', () => {
      const inner: Record<string, unknown> = {};
      inner.self = inner;
      expect(() => hashValue([inner, inner])).not.toThrow();
    });

    test('cycle inside a Map value does not stack overflow', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(() => hashValue(new Map([['key', obj]]))).not.toThrow();
    });

    test('cycle inside a Set does not stack overflow', () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      // Sets hold values by reference; the object itself is the set member
      const set = new Set<unknown>([obj]);
      expect(() => hashValue(set)).not.toThrow();
    });
  });
});
