import { useCallback as _useCallback } from "react";
import { useReactive } from 'signalium/react';
export function useThing(id: string) {
  return useReactive(_useCallback(function* () {
    const res = yield fetch(`/api/${id}`);
    return res.json();
  }, [id]));
}
