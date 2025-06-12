import { useContext } from 'react';
import { ScopeContext } from './context.js';
import { ContextImpl, ContextPair, ROOT_SCOPE, SignalScope } from '../internals/contexts.js';

export function ContextProvider<C extends unknown[]>({
  children,
  contexts = [],
  inherit = true,
}: {
  children: React.ReactNode;
  contexts?: [...ContextPair<C>] | [];
  inherit?: boolean;
}) {
  const parentScope = useContext(ScopeContext) ?? ROOT_SCOPE;
  const scope = new SignalScope(contexts as [ContextImpl<unknown>, unknown][], inherit ? parentScope : undefined);

  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}
