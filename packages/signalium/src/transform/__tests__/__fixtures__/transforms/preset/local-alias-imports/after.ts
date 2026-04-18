import { reactive as reactive2, ReactivePromise } from 'signalium';
export function useThing() {
  return reactive2(function* () {
    return ReactivePromise.all([1, 2, 3]);
  });
}


