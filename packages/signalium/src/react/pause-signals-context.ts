import React, { createContext, useContext, useEffect, useRef } from 'react';
import { ReactiveSignal } from '../internals/reactive.js';

class PauseSignalsManager {
  /**
   * Registered signals, with the number of mounted readers that registered each one. Hooks such as
   * `useReactiveShallow` read scope-cached signals that several components share, so one reader
   * unmounting must not stop the manager from pausing the signal for the others.
   */
  private signals = new Map<ReactiveSignal<any, any>, number>();
  private _paused: boolean;

  constructor(initialPaused: boolean) {
    this._paused = initialPaused;
  }

  get paused() {
    return this._paused;
  }

  /**
   * Registers a mounted reader's signal and reconciles the watch its subscriptions hold with the
   * current pause state. Call from a commit-phase effect that runs after the store subscription
   * is established, once per reader, and pair it with one `unregister`: the reader may have
   * rendered (and taken its render lease) under a different pause state than the one it commits
   * under, and StrictMode's effect replay re-subscribes (re-watching) the signal regardless of the
   * pause state.
   */
  register(signal: ReactiveSignal<any, any>) {
    this.signals.set(signal, (this.signals.get(signal) ?? 0) + 1);

    if (this._paused) {
      signal._pauseWatch();
    } else {
      signal._resumeWatch();
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
  }

  setPaused(value: boolean) {
    if (value === this._paused) return;
    this._paused = value;
    for (const signal of this.signals.keys()) {
      if (value) {
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
