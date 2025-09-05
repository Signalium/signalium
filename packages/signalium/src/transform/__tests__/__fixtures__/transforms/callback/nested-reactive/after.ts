import { signal, reactive, callback as _callback } from 'signalium';

const sa = signal(0);
const sb = signal(0);

const getValue = reactive(() => {
  const a = sa.value;

  const ab = reactive(_callback(() => {
    return a + sb.value;
  }, 0, [a]));

  return ab();
});
