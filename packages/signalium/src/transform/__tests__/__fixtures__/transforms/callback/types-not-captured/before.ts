import { reactive } from 'signalium';

type T = number;
interface I { a: number }
type Fn = (x: T) => number;

export function useThing() {
  return reactive(() => {
    const x: T = 1 as number;
    function add(a: T): number { return a + x; }
    const f: Fn = (n: T): number => n + x;
    const foo = {} as I;
    return [1, 2, 3].map(add).map(f);
  });
}


