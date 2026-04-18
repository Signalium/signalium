
import { createContext, getContext, reactive, ReactivePromise } from "signalium";
const ctx = createContext('default');
const inner = reactive(function* () {
  yield ReactivePromise.resolve();
  return 'inner-value';
});
const outer = reactive(function* () {
  const result = yield inner();
  const contextValue = getContext(ctx);
  return result + '-' + contextValue;
});
