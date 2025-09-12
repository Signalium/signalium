import { reactive } from '@phantom/signalium';

export function useThing() {
  return reactive(async () => {
    await Promise.resolve();
  });
}


