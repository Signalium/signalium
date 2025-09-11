import { reactive, callback as _callback } from 'signalium';
import type { Foo } from './types';

export function useThing() {
  return reactive(() => {
    const x = 1;
    const add = _callback(function add(a: number) {
      return a + x;
    }, 0, [x]);
    const y: Foo = {
      val: 1
    } as Foo;
    return [1, 2, 3].map(add);
  });
}


