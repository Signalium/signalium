import { useCallback as _useCallback } from "react";
import { useReactive } from 'signalium/react';
export function useThing() {
  return useReactive(_useCallback(() => 1 + 2, []));
}
