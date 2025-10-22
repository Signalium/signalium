import { ReactiveFnSignal } from './reactive.js';

let CURRENT_CONSUMER: ReactiveFnSignal<any, any> | undefined;

let IS_WATCHING = false;

export const setIsWatching = (isWatching: boolean) => {
  IS_WATCHING = isWatching;
};

export const setCurrentConsumer = (consumer: ReactiveFnSignal<any, any> | undefined) => {
  CURRENT_CONSUMER = consumer;
};

export const getCurrentConsumer = () => {
  return CURRENT_CONSUMER;
};