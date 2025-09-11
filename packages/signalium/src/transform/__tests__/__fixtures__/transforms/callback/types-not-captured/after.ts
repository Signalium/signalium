import { reactive, callback as _callback } from 'signalium';
type T = number;
interface I {
  a: number;
}
type Fn = (x: T) => number;
export function useThing() {
  return reactive(() => {
    const x: T = 1 as number;
    const add = _callback(function add(a: T) {
      return a + x;
    }, 0, [x]);
    const f: Fn = _callback((n: T): number => n + x, 1, [x]);
    const foo = {} as I;
    return [1, 2, 3].map(add).map(f);
  });
}
