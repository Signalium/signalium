import { useCallback as _useCallback } from "react";
import { useReactive, useReactiveShallow, useReactiveDeep } from 'signalium/react';
const SYNC = {
  delivery: 'sync'
} as const;
export function useThing(id: string, delivery: 'sync' | 'state') {
  const a = useReactive(_useCallback(() => id.length, [id]), {
    delivery: 'sync'
  });
  const b = useReactiveShallow(_useCallback(() => ({
    id
  }), [id]), {
    delivery
  });
  const c = useReactiveDeep(_useCallback(() => [id], [id]), SYNC);
  return [a, b, c];
}
