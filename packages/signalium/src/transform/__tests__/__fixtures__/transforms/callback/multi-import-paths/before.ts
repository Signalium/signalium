import { reactive } from '@phantom/signalium';
import { reactive as reactive2 } from 'signalium';

export function useThing() {
  return reactive(() => {
    return [1, 2, 3].map((a: number) => a + 1);
  });
}
export function useThing2() {
  return reactive2(() => {
    return [1, 2, 3].map((a: number) => a + 1);
  });
}


