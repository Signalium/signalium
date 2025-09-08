import { useRef } from 'react';
import { SignalOptions, Signal } from '../types.js';
import { signal } from '../index.js';

export function useSignal<T>(value: T, opts?: SignalOptions<T>): Signal<T> {
  const ref = useRef<Signal<T> | undefined>(undefined);

  if (!ref.current) {
    ref.current = signal(value, opts);
  }

  return ref.current;
}
