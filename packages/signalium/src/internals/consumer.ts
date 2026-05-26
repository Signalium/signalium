import { ReactiveSignal } from './reactive.js';
import type { Effect } from './effect.js';

/**
 * Anything that can act as the "consumer" inside a reactive computation —
 * i.e. anything that can read signals, register dep edges, and be scheduled
 * via the pull queue. Both `ReactiveSignal` and `Effect` satisfy the
 * structural shape that the dep-graph (`edge.ts`), dirty propagation
 * (`dirty.ts`), and pull queue (`scheduling.ts`) expect from a consumer.
 */
export type ReactiveConsumer = ReactiveSignal<any, any> | Effect;

let CURRENT_CONSUMER: ReactiveConsumer | undefined;

let IS_WATCHING = false;

export const setIsWatching = (isWatching: boolean) => {
  IS_WATCHING = isWatching;
};

export const setCurrentConsumer = (consumer: ReactiveConsumer | undefined) => {
  CURRENT_CONSUMER = consumer;
};

export const getCurrentConsumer = () => {
  return CURRENT_CONSUMER;
};

export const getIsWatching = () => {
  return IS_WATCHING;
};

export const untrack = <T>(fn: () => T): T => {
  const prevConsumer = CURRENT_CONSUMER;
  CURRENT_CONSUMER = undefined;
  try {
    return fn();
  } finally {
    CURRENT_CONSUMER = prevConsumer;
  }
};
