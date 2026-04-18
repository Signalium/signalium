import { useReactive } from 'signalium/react';

export function useThing(id: string) {
  return useReactive(async () => {
    const res = await fetch(`/api/${id}`);
    return res.json();
  });
}
