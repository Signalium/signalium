import { reactive as reactive2 } from 'signalium';

export function useThing() {
  return reactive2(async () => {
    return Promise.all([1, 2, 3]);
  });
}


