import { reactiveMethod, relay } from 'signalium';

export class QueryClient {
  getQuery = reactiveMethod(this, () => {});
}
