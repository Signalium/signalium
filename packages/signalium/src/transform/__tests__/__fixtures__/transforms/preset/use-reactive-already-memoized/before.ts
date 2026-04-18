import { useReactive } from 'signalium/react';
import { useCallback } from 'react';

export function useThing(x: number) {
  const fn = useCallback(() => x * 2, [x]);
  return useReactive(fn);
}
