import { useContext, useMemo } from 'react';
import { ScopeContext } from './context.js';
import { ContextImpl, ContextPair, getGlobalScope, SignalScope } from '../internals/contexts.js';
import { hashValue } from '../internals/utils/hash.js';

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

  const scope = useMemo(
    () => new SignalScope(contexts as [ContextImpl<unknown>, unknown][], inherit ? parentScope : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parentScope, inherit, hashValue(contexts)],
  );

  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}
