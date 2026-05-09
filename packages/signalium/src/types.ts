export interface Signal<T> {
  value: T;
  update(updater: (value: T) => T): void;
}

export interface ReadonlySignal<T> {
  readonly value: ReactiveValue<T>;
}

export type ReactiveFn<T, Args extends unknown[]> = (...args: Args) => ReactiveValue<T>;

export interface Watcher<T> {
  readonly value: ReactiveValue<T>;
  addListener(listener: () => void, opts?: { skipInitial?: boolean }): () => void;
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
  readonly isPending: boolean;
  value: T | undefined;
  setPromise: (promise: Promise<T>) => void;
  setError: (error: unknown) => void;
}

export type RelayActivate<T> = (state: RelayState<T>) => RelayHooks | (() => unknown) | undefined | void;

export interface SignalOptions<T> {
  equals?: Equals<T> | false;
  id?: string;
  desc?: string;
  throwIfRunning?: boolean;
}

export interface ReactiveOptions<T, Params extends unknown[]> extends SignalOptions<T> {
  paramKey?: (...params: Params) => string | number;
}

/**
 * Internal shape shared by both branches of the {@link ReactivePromise} union.
 * Not part of the public API — consumers should use {@link ReactivePromise},
 * {@link PendingReactivePromise}, or {@link ReadyReactivePromise}.
 */
export interface BaseReactivePromise<T> extends Promise<T> {
  readonly error: unknown;

  readonly isPending: boolean;
  readonly isRejected: boolean;
  readonly isResolved: boolean;
  readonly isSettled: boolean;
}

export interface PendingReactivePromise<T> extends BaseReactivePromise<T> {
  readonly value: undefined;
  readonly isReady: false;
}

export interface ReadyReactivePromise<T> extends BaseReactivePromise<T> {
  readonly value: T;
  readonly isReady: true;
}

export type ReactivePromise<T> = PendingReactivePromise<T> | ReadyReactivePromise<T>;

export interface ReactivePromiseConstructor {
  readonly prototype: ReactivePromise<any>;

  new <T>(
    executor?: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason: unknown) => void) => void,
  ): ReactivePromise<T>;

  all<T extends readonly unknown[] | []>(values: T): ReactivePromise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  race<T extends readonly unknown[] | []>(values: T): ReactivePromise<Awaited<T[number]>>;
  any<T>(values: Iterable<T | PromiseLike<T>>): ReactivePromise<Awaited<T>>;
  any<T extends readonly unknown[] | []>(values: T): ReactivePromise<Awaited<T[number]>>;
  allSettled<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<Awaited<T>>[]>;
  allSettled<T extends readonly unknown[] | []>(
    values: T,
  ): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }>;
  resolve<T>(value: T): ReactivePromise<T>;
  reject<T = never>(reason: any): ReactivePromise<T>;
  withResolvers<T>(): {
    promise: ReactivePromise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason: unknown) => void;
  };
}

export type ReactiveTask<T, Params extends unknown[]> = ReactivePromise<T> & {
  run(...params: Params): ReactivePromise<T>;
};

export type ReactiveValue<T> =
  // We have to first check if T is a ReactiveTask, because it will also match Promise<T>
  T extends ReactiveTask<infer U, infer Args>
    ? ReactiveTask<U, Args>
    : T extends Promise<infer U>
      ? ReactivePromise<U>
      : T extends Generator<any, infer U>
        ? ReactivePromise<U>
        : T;

export interface Context<T> {
  readonly defaultValue: T;
}
