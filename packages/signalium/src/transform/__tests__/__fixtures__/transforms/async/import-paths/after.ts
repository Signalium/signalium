import { reactive } from '@phantom/signalium';
export function useThing() {
  return reactive(function* () {
    yield Promise.resolve();
  });
}


