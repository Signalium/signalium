import { context } from 'signalium';
import { useContext } from 'signalium/react';

export const QueryClientContext = context<QueryClient | null>(null);

export const useQueryClient = () => {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) {
    throw new Error('QueryClient not found');
  }
  return queryClient;
};
