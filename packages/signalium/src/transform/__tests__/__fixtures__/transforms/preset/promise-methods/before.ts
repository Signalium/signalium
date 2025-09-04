import { reactive } from 'signalium';

export function useThing() {
  return reactive(async () => {
    const a = Promise.resolve(1);
    const b = Promise.resolve(2);
    const results = await Promise.all([a, b]);
    const fastest = await Promise.race([a, b]);
    const any = await Promise.any([a, b]);
    const settled = await Promise.allSettled([a, b]);
    return results[0] + fastest + any + (settled.length || 0);
  });
}


