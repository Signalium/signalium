import { useCallback as _useCallback } from "react";
import { useReactiveDeep } from 'signalium/react';
export function useThing(id: string) {
  return useReactiveDeep(_useCallback(() => ({
    id,
    nested: {
      value: id.length
    }
  }), [id]));
}
