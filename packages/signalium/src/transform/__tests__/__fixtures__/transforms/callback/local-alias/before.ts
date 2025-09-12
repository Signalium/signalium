import { reactive as reactive2 } from 'signalium';

export function useThing() {
  return reactive2(() => {
    return [1, 2, 3].map((a: number) => a + 1);
  });
}


