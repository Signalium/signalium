import { useReactive } from 'signalium/react';

export function useThing(count: number, multiplier: number) {
  return useReactive(() => count * multiplier);
}
