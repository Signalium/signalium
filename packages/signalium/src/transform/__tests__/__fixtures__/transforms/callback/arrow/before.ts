import { reactive } from 'signalium';

export function useThing() {
  return reactive(() => {
    return [1, 2, 3].map((a: number) => a + 1);
  });
}
