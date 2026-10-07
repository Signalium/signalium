import React, { createContext, useContext, useEffect, useRef } from 'react';
import { ReactiveSignal } from '../internals/reactive.js';
import { watchSignal, unwatchSignal } from '../internals/watch.js';
import { schedulePull } from '../internals/scheduling.js';

class PauseSignalsManager {
  private signals = new Set<ReactiveSignal<any, any>>();
  private _paused: boolean;

  constructor(initialPaused: boolean) {
    this._paused = initialPaused;
  }

  get paused() {
    return this._paused;
  }

  register(signal: ReactiveSignal<any, any>) {
    this.signals.add(signal);
  }

  /**
   * Registers a signal whose only watcher is a single mounted component's store subscription
   * (`component()` signals), and reconciles its watch state with the current pause state. Call
   * from a commit-phase effect that runs after the subscription is established: the component may
   * have rendered under a different pause state than the one it commits under, and StrictMode's
   * effect replay re-subscribes (re-watching) the signal regardless of the pause state.
   */
  registerOwned(signal: ReactiveSignal<any, any>) {
    this.signals.add(signal);

    const watched = signal.watchCount > 0;

    if (this._paused) {
      if (watched) {
        unwatchSignal(signal, { isPausing: true });
      }
    } else if (!watched) {
      watchSignal(signal);
      schedulePull(signal);
    }
  }

  unregister(signal: ReactiveSignal<any, any>) {
    this.signals.delete(signal);
  }

  setPaused(value: boolean) {
    if (value === this._paused) return;
    this._paused = value;
    for (const signal of this.signals) {
      if (value) {
        unwatchSignal(signal, { isPausing: true });
      } else {
        watchSignal(signal);
        schedulePull(signal);
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
