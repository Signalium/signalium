import { useCallback as _useCallback } from "react";
import { useReactive } from 'signalium/react';
export function useThing(count: number, multiplier: number) {
  return useReactive(_useCallback(() => count * multiplier, [count, multiplier]));
}
