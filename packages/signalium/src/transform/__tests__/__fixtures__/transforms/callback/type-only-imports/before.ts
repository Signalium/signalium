import { reactive } from 'signalium';
import type { Foo } from './types';

export function useThing() {
  return reactive(() => {
    const x = 1;
    function add(a: number): number { return a + x; }
    const y: Foo = { val: 1 } as Foo;
    return [1, 2, 3].map(add);
  });
}


