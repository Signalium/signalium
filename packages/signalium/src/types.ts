export interface Signal<T> {
  value: T;
  update(updater: (value: T) => T): void;
}

export type ReactiveFn<T, Args extends unknown[]> = (...args: Args) => ReactiveValue<T>;

export interface Watcher<T> {
  readonly value: ReactiveValue<T>;
  addListener(listener: () => void): () => void;
}

export interface Notifier {
  consume(): void;
  notify(): void;
}

export type Equals<T> = (prev: T, next: T) => boolean;

export type RelayHooks = {
  update?(): void;
  deactivate?(): void;
};

export interface RelayState<T> {
  value: T | undefined;
  setPromise: (promise: Promise<T>) => void;
  setError: (error: unknown) => void;
}

export type RelayActivate<T> = (state: RelayState<T>) => RelayHooks | (() => unknown) | undefined | void;

export interface SignalOptions<T> {
  equals?: Equals<T> | false;
  id?: string;
  desc?: string;
}

export interface ReactiveOptions<T, Params extends unknown[]> extends SignalOptions<T> {
  paramKey?: (...params: Params) => string | number;
}

export interface ReactivePromise<T> extends Promise<T> {
  readonly value: T | undefined;
  readonly error: unknown;

  readonly isPending: boolean;
  readonly isRejected: boolean;
  readonly isResolved: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
}

export interface PendingReactivePromise<T> extends ReactivePromise<T> {
  readonly value: undefined;
  readonly isReady: false;
}

export interface ReadyReactivePromise<T> extends ReactivePromise<T> {
  readonly value: T;
  readonly isReady: true;
}

export type DiscriminatedReactivePromise<T> = PendingReactivePromise<T> | ReadyReactivePromise<T>;

export type ReactiveTask<T, Params extends unknown[]> = DiscriminatedReactivePromise<T> & {
  run(...params: Params): DiscriminatedReactivePromise<T>;
};

export type ReactiveValue<T> =
  // We have to first check if T is a ReactiveTask, because it will also match Promise<T>
  T extends ReactiveTask<infer U, infer Args>
    ? ReactiveTask<U, Args>
    : T extends Promise<infer U>
      ? DiscriminatedReactivePromise<U>
      : T extends Generator<any, infer U>
        ? DiscriminatedReactivePromise<U>
        : T;
