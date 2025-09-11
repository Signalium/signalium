import { reactive, getContext, createContext } from "@phantom/signalium";

const ctx = createContext('default');

const inner = reactive(async () => {
  await Promise.resolve();
  return 'inner-value';
});

const outer = reactive(async () => {
  const result = await inner();
  const contextValue = getContext(ctx);
  return result + '-' + contextValue;
});


