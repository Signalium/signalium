import { createContext, useContext as useReactContext } from 'react';
import { Context, ContextImpl, SignalScope } from '../internals/contexts.js';
import { CURRENT_CONSUMER } from '../internals/consumer.js';

export const ScopeContext = createContext<SignalScope | undefined>(undefined);

export function useScope() {
  return useReactContext(ScopeContext);
}

export function useContext<T>(context: Context<T>): T {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const scope = CURRENT_CONSUMER?.scope ?? useScope();

  if (!scope) {
    throw new Error('useContext must be used within a signal hook, a withContext, or a component');
  }

  return scope.getContext(context) ?? (context as unknown as ContextImpl<T>).defaultValue;
}
