'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { CodeFence } from './Fence';
import clsx from 'clsx';

type Mode = 'react' | 'signalium';

const STORAGE_KEY = 'signalium-docs-mode';

const ModeContext = createContext<{
  mode: Mode;
  setMode: (mode: Mode) => void;
}>({
  mode: 'react',
  setMode: () => {},
});

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('react');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'react' || stored === 'signalium') {
      setModeState(stored);
    }
  }, []);

  const setMode = useCallback((mode: Mode) => {
    setModeState(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, []);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}

export function ModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useMode();

  return (
    <div
      className={clsx('flex border-b border-primary-800 text-xs', className)}
    >
      <button
        onClick={() => setMode('react')}
        className={clsx(
          'flex-1 py-2 text-center transition-colors',
          mode === 'react'
            ? 'bg-tertiary-300/10 font-medium text-tertiary-300'
            : 'text-primary-400 hover:text-white',
        )}
      >
        React + Hooks
      </button>
      <button
        onClick={() => setMode('signalium')}
        className={clsx(
          'flex-1 py-2 text-center transition-colors',
          mode === 'signalium'
            ? 'bg-tertiary-300/10 font-medium text-tertiary-300'
            : 'text-primary-400 hover:text-white',
        )}
      >
        React + Signalium
      </button>
    </div>
  );
}

export function CodeSwitcher({
  react,
  signalium,
  language = 'tsx',
}: {
  react: string;
  signalium: string;
  language?: string;
}) {
  const { mode } = useMode();

  return (
    <div className="not-prose relative my-6">
      <div className="flex items-center gap-2 rounded-t-lg border-b border-primary-700/50 bg-primary-800/50 px-4 py-2">
        <ModeTabs />
      </div>
      <div className="rounded-b-lg bg-primary-1000">
        <CodeFence language={language}>
          {mode === 'react' ? react : signalium}
        </CodeFence>
      </div>
    </div>
  );
}

function ModeTabs() {
  const { mode, setMode } = useMode();

  return (
    <div className="flex gap-2 text-xs">
      <button
        onClick={() => setMode('react')}
        className={clsx(
          'rounded px-2 py-1 transition-colors',
          mode === 'react'
            ? 'bg-tertiary-300/10 text-tertiary-300'
            : 'text-primary-400 hover:text-white',
        )}
      >
        React + Hooks
      </button>
      <button
        onClick={() => setMode('signalium')}
        className={clsx(
          'rounded px-2 py-1 transition-colors',
          mode === 'signalium'
            ? 'bg-tertiary-300/10 text-tertiary-300'
            : 'text-primary-400 hover:text-white',
        )}
      >
        React + Signalium
      </button>
    </div>
  );
}

export function ModeContent({
  react,
  signalium,
}: {
  react: React.ReactNode;
  signalium: React.ReactNode;
}) {
  const { mode } = useMode();
  return <>{mode === 'react' ? react : signalium}</>;
}
