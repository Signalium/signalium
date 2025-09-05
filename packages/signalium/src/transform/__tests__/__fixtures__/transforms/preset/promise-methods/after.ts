import { reactive, callback as _callback, ReactivePromise } from 'signalium';

export function useThing() {
  return reactive(function* () {
    const a = ReactivePromise.resolve(1);
    const b = ReactivePromise.resolve(2);
    const results = yield ReactivePromise.all([a, b]);
    const fastest = yield ReactivePromise.race([a, b]);
    const any = yield ReactivePromise.any([a, b]);
    const settled = yield ReactivePromise.allSettled([a, b]);
    return results[0] + fastest + any + (settled.length || 0);
  });
}


