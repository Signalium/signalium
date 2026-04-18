import { useReactiveDeep } from 'signalium/react';

export function useThing(id: string) {
  return useReactiveDeep(() => ({ id, nested: { value: id.length } }));
}
