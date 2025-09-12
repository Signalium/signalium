import { reactive, relay, signal, callback as _callback } from 'signalium';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const value = signal('Hello');

const derived = reactive(() => {
  return relay<string>(state => {
    const run = _callback(function* () {
      yield sleep(100);

      try {
        return `${value.value}, World`;
      } catch (e) {
        console.error(e);
        return 'Error';
      }
    }, 0);

    state.setPromise(run());
  });
});
