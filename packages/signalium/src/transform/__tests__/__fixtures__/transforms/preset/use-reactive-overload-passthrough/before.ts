import { useReactive } from 'signalium/react';
import { reactive, type Signal } from 'signalium';

const derived = reactive((x: number) => x * 2);

export function useThing(sig: Signal<number>, x: number) {
  const a = useReactive(sig);
  const b = useReactive(derived, x);
  return a + b;
}
