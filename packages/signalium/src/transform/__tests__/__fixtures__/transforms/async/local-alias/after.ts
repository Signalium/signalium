import { reactive as reactive2 } from 'signalium';

export function useThing() {
  return reactive2(function* () {
    yield fetch('/api');
    return 1;
  });
}


