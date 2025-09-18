import {
  scheduleTracer,
  Tracer,
  TRACER,
  TracerEventType,
  SignalType,
} from 'signalium/debug';
import { useRef, useState as _useState, useEffect } from 'react';

let CURRENT_HOOK_ID: string | undefined;

interface HookOptions {
  desc?: string;
}

export function hook<T, Args extends unknown[]>(
  type: SignalType,
  fn: (...args: Args) => T,
  { desc }: HookOptions = {},
): (...args: Args) => T {
  return (...args: Args) => {
    const fnName = desc ?? fn.name;
    const stringifiedArgs = JSON.stringify(args).slice(1, -1);
    const hookId = `${fnName}(${stringifiedArgs})`;
    const connectedId = useRef('');

    if (connectedId.current !== hookId) {
      connectedId.current = hookId;
      TRACER?.emit({
        type: TracerEventType.Connected,
        id: CURRENT_HOOK_ID!,
        childId: hookId,
        nodeType: type,
        name: fnName,
        params: stringifiedArgs,
      });
    }

    TRACER?.emit({
      type: TracerEventType.StartUpdate,
      id: hookId,
    });

    let PREV_HOOK_ID = CURRENT_HOOK_ID;

    try {
      CURRENT_HOOK_ID = hookId;

      const result = fn(...args);

      TRACER?.emit({
        type: TracerEventType.EndUpdate,
        id: hookId,
        value: result,
      });

      return result;
    } finally {
      CURRENT_HOOK_ID = PREV_HOOK_ID;
    }
  };
}

export const useState: typeof _useState = <T>(
  ...args: Parameters<typeof _useState<T>>
) => {
  const [state, _setState] = _useState<T>(...args);

  TRACER?.emit({
    type: TracerEventType.ConsumeState,
    id: CURRENT_HOOK_ID!,
    childId: `useState`,
    name: `useState`,
    value: state,
    setValue: (value: unknown) => {
      _setState(value as T);
    },
  });

  const setState = (value: T) => {
    _setState(value);
  };

  return [state, setState];
};

export const reactiveHook = <T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts: HookOptions = {},
): ((...args: Args) => T) => {
  return hook(SignalType.Reactive, fn, opts);
};

export const createHookWatcher = <T>(
  tracer: Tracer,
  fn: () => T,
  id: string,
  desc: string,
) => {
  const hookFn = () => {
    TRACER?.emit({
      type: TracerEventType.StartUpdate,
      id,
    });

    try {
      CURRENT_HOOK_ID = id;
      const result = fn();

      TRACER?.emit({
        type: TracerEventType.EndUpdate,
        id,
        value: result,
      });
    } finally {
      CURRENT_HOOK_ID = undefined;
      scheduleTracer(tracer);
    }
  };

  return {
    run: () => {
      hookFn();
    },
  };
};
