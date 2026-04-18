import { useReactive } from 'signalium/react';

export function useThing() {
  return useReactive(() => 1 + 2);
}
