import { SignalScope } from './internals/contexts.js';

export interface Signal<T> {
  value: T;
  update(updater: (value: T) => T): void;
}

export interface ReadonlySignal<T> {
  readonly value: T;
}

export type SignalEquals<T> = (prev: T, next: T) => boolean;

export type SignalListener = () => void;

export type RelayHooks = {
  update?(): void;
  deactivate?(): void;
};

export interface RelayState<T> {
  value: T | undefined;
  setPromise: (promise: Promise<T>) => void;
  setError: (error: unknown) => void;
}

export type SignalActivate<T> = (state: RelayState<T>) => RelayHooks | (() => unknown) | undefined | void;

export interface SignalOptions<T, Args extends unknown[]> {
  equals?: SignalEquals<T> | false;
  id?: string;
  desc?: string;
  scope?: SignalScope;
  paramKey?: (...args: Args) => string;

  /**
   * Called when signal's watchCount reaches 0.
   * Return `true` to allow GC, `false` to prevent it.
   * If not provided, defaults to always allowing GC.
   */
  shouldGC?: (signal: object, value: T, args: Args) => boolean;
}

export interface SignalOptionsWithInit<T, Args extends unknown[]> extends SignalOptions<T, Args> {
  initValue: T extends Promise<infer U> ? U : T extends Generator<any, infer U, any> ? U : T;
}

export interface Thenable<T> {
  then(onfulfilled?: (value: T) => void, onrejected?: (reason: unknown) => void): void;
  finally: any;
  catch: any;
  [Symbol.toStringTag]: string;
}

export interface BaseReactivePromise<T> extends Promise<T>, ReadonlySignal<T | undefined> {
  value: T | undefined;
  error: unknown;

  isPending: boolean;
  isRejected: boolean;
  isResolved: boolean;
  isSettled: boolean;
  isReady: boolean;
}

export interface PendingReactivePromise<T> extends BaseReactivePromise<T> {
  value: undefined;
  isReady: false;
}

export interface ReadyReactivePromise<T> extends BaseReactivePromise<T> {
  value: T;
  isReady: true;
}

export type ReactivePromise<T> = PendingReactivePromise<T> | ReadyReactivePromise<T>;

export type ReactiveTask<T, Args extends unknown[]> = ReactivePromise<T> & {
  run(...args: Args): ReactivePromise<T>;
};

export type SignalValue<T> =
  // We have to first check if T is a ReactiveTask, because it will also match Promise<T>
  T extends ReactiveTask<infer U, infer Args>
    ? ReactiveTask<U, Args>
    : T extends Promise<infer U>
      ? ReactivePromise<U>
      : T extends Generator<any, infer U>
        ? ReactivePromise<U>
        : T;

// This type is used when initial values are provided to async functions and
// relays. It allows us to skip checking `isReady` when there is always
// a guaranteed value to return.
export type ReadySignalValue<T> =
  T extends ReactiveTask<infer U, infer Args>
    ? ReactiveTask<U, Args>
    : T extends Promise<infer U>
      ? ReadyReactivePromise<U>
      : T extends Generator<any, infer U>
        ? ReadyReactivePromise<U>
        : T;
