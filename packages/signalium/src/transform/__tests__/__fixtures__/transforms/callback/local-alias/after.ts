import { reactive as reactive2, callback as _callback } from 'signalium';
export function useThing() {
  return reactive2(() => {
    return [1, 2, 3].map(_callback((a: number) => a + 1, 0));
  });
}


