import { reactive as reactive2 } from 'signalium';

export function useThing() {
  return reactive2(async () => {
    await fetch('/api');
    return 1;
  });
}


