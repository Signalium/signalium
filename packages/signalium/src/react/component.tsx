import { useMemo, useRef, useSyncExternalStore } from 'react';
import { useScope } from './context.js';
import { createReactiveFnSignal, ReactiveFnSignal } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { hashValue } from '../internals/utils/hash.js';

export default function component<Props extends object>(
  fn: (props: Props) => React.ReactNode | React.ReactNode[] | null,
) {
  const Component = (props: Props) => {
    const scope = useScope();

    const fnSignalRef = useRef<ReactiveFnSignal<React.ReactNode | React.ReactNode[] | null, []> | undefined>(undefined);
    const propsRef = useRef<Props>(props);

    propsRef.current = props;

    let signal = fnSignalRef.current;

    if (!signal) {
      fnSignalRef.current = signal = createReactiveFnSignal(
        {
          compute: () => fn(propsRef.current),
          equals: () => false,
          isRelay: false,
          tracer: undefined,
        },
        [],
        undefined,
        scope,
      );

      signal._isLazy = true;
    }

    // We always want to re-render when the signal is updated, regardless of
    // whether or not the result changed. This is because the signal is lazy,
    // so it will not be updated until the next render.
    useSyncExternalStore(
      signal.addListenerLazy(),
      () => signal.updatedCount,
      () => signal.updatedCount,
    );

    runSignal(signal as ReactiveFnSignal<any, any[]>);

    return signal.value;
  };

  return (props: Props) => {
    const hash = hashValue(props);
    // Renders Comp only when hash changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => <Component {...props} />, [hash]);
  };
}
