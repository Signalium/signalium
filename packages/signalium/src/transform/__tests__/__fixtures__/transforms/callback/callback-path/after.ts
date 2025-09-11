import { callback } from "@phantom/signalium";
import { reactive } from 'signalium';
export function useThing() {
  return reactive(() => {
    return [1, 2, 3].map(callback((a: number) => a + 1, 0));
  });
}


