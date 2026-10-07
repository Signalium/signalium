import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { ReactiveSignal } from '../internals/reactive.js';

export class PauseSignalsManager {
  /**
   * Registered signals, with the number of mounted readers that registered each one. Hooks such as
   * `useReactiveShallow` read scope-cached signals that several components share, possibly across
   * providers, so each signal counts its paused readers rather than being paused outright.
   */
  private signals = new Map<ReactiveSignal<any, any>, number>();
  /**
   * Render leases taken under this provider that no commit has claimed yet, such as a mount that
   * suspended. Pausing drops their watch too. Ended leases are pruned lazily.
   */
  private leases = new Set<ReactiveSignal<any, any>>();
  private pruneLeasesAt = 64;
  private _paused: boolean;

  constructor(initialPaused: boolean) {
    this._paused = initialPaused;
  }

  get paused() {
    return this._paused;
  }

  trackLease(signal: ReactiveSignal<any, any>) {
    const leases = this.leases;

    leases.add(signal);

    if (leases.size >= this.pruneLeasesAt) {
      for (const leased of leases) {
        if (!leased._isLeased) leases.delete(leased);
      }

      this.pruneLeasesAt = Math.max(64, leases.size * 2);
    }
  }

  /**
   * Counts a mounted reader of `signal`. Call before the reader subscribes, so a paused reader
   * never takes the watch, even briefly, and pair it with one `unregister`.
   */
  register(signal: ReactiveSignal<any, any>) {
    this.signals.set(signal, (this.signals.get(signal) ?? 0) + 1);
    this.leases.delete(signal);

    if (this._paused) {
      signal._addPausedReaders(1);
    }
  }

  unregister(signal: ReactiveSignal<any, any>) {
    const count = this.signals.get(signal);

    if (count === undefined) return;

    if (count > 1) {
      this.signals.set(signal, count - 1);
    } else {
      this.signals.delete(signal);
    }

    if (this._paused) {
      // The reader may not have unsubscribed yet; reconciling now could briefly re-watch a signal
      // whose only subscriber is this paused reader.
      signal._addPausedReaders(-1, true);
    }
  }

  setPaused(value: boolean) {
    if (value === this._paused) return;
    this._paused = value;

    for (const [signal, count] of this.signals) {
      signal._addPausedReaders(value ? count : -count);
    }

    for (const signal of this.leases) {
      if (!signal._isLeased) {
        this.leases.delete(signal);
      } else if (value) {
        signal._pauseWatch();
      } else {
        signal._resumeWatch();
      }
    }
  }
}

const PauseSignalsManagerContext = createContext<PauseSignalsManager | null>(null);

export function PauseSignalsProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  const managerRef = useRef<PauseSignalsManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = new PauseSignalsManager(value);
  }

  const manager = managerRef.current;

  useEffect(() => {
    manager.setPaused(value);
  }, [manager, value]);

  return React.createElement(PauseSignalsManagerContext.Provider, { value: manager }, children);
}

export function usePauseSignalsManager(): PauseSignalsManager | null {
  return useContext(PauseSignalsManagerContext);
}

/**
 * `signal.addListenerLazy` for a render under `manager`: watches the signal unless paused, and
 * lets pausing reach the lease if the render never commits.
 */
export function addRenderListener(signal: ReactiveSignal<any, any>, manager: PauseSignalsManager | null) {
  const subscribe = signal.addListenerLazy(!manager?.paused);

  if (manager !== null && signal._isLeased) {
    manager.trackLease(signal);
  }

  return subscribe;
}

/** `useSyncExternalStore` for a reader under `manager`, registered before it subscribes. */
export function usePausableStore<T>(
  manager: PauseSignalsManager | null,
  signal: ReactiveSignal<any, any>,
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => T,
): T {
  useEffect(() => {
    if (manager === null) return;
    manager.register(signal);
    return () => manager.unregister(signal);
  }, [manager, signal]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
