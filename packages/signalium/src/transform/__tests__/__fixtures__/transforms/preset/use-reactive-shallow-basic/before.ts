import { useReactiveShallow } from 'signalium/react';

export function useThing(id: string) {
  return useReactiveShallow(() => ({ id }));
}
