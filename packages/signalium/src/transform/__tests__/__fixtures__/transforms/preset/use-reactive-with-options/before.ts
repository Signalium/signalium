import { useReactive, useReactiveShallow, useReactiveDeep } from 'signalium/react';

const SYNC = { delivery: 'sync' } as const;

export function useThing(id: string, delivery: 'sync' | 'state') {
  const a = useReactive(() => id.length, { delivery: 'sync' });
  const b = useReactiveShallow(() => ({ id }), { delivery });
  const c = useReactiveDeep(() => [id], SYNC);
  return [a, b, c];
}
