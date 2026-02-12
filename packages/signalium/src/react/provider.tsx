import { useContext, useRef } from 'react';
import { ScopeContext } from './context.js';
import { ContextImpl, ContextPair, getGlobalScope, SignalScope } from '../internals/contexts.js';

export function ContextProvider<C extends unknown[]>({
  children,
  contexts = [],
  inherit = true,
}: {
  children: React.ReactNode;
  contexts?: [...ContextPair<C>] | [];
  inherit?: boolean;
}) {
  const parentScope = useContext(ScopeContext) ?? getGlobalScope();
  const scopeRef = useRef<SignalScope | null>(null);
  if (scopeRef.current === null) {
    scopeRef.current = new SignalScope(
      contexts as [ContextImpl<unknown>, unknown][],
      inherit ? parentScope : undefined,
    );
  }

  return <ScopeContext.Provider value={scopeRef.current}>{children}</ScopeContext.Provider>;
}
