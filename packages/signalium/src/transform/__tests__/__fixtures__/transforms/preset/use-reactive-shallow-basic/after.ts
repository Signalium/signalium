import { useCallback as _useCallback } from "react";
import { useReactiveShallow } from 'signalium/react';
export function useThing(id: string) {
  return useReactiveShallow(_useCallback(() => ({
    id
  }), [id]));
}
