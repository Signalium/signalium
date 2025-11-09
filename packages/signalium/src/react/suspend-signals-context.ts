import { createContext, useContext } from 'react';

const SuspendSignalsContext = createContext<boolean>(false);

export const SuspendSignalsProvider = SuspendSignalsContext.Provider;

export function useSignalsSuspended(): boolean {
  return useContext(SuspendSignalsContext);
}
