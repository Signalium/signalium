import { describe, expect, it } from 'vitest';
import { createReactiveSignal, ReactiveSignal } from '../internals/reactive.js';
import { runSignal } from '../internals/get.js';
import { runSyncReplayAsyncComponent } from '../react/async-component.js';

describe('async component sync replay driver', () => {
  it('completes synchronously when generator returns without suspending yield', () => {
    let owned!: ReactiveSignal<string | null, []>;
    owned = createReactiveSignal(
      {
        compute: () =>
          runSyncReplayAsyncComponent(
            function* () {
              yield undefined;
              return 'ok';
            },
            {},
            owned,
          ),
        equals: () => false,
        isRelay: false,
        tracer: undefined,
      },
      [],
      undefined,
      undefined,
    );
    owned._isLazy = true;
    runSignal(owned);
    expect(owned.value).toBe('ok');
  });

  it('throws native Promise when yielded promise is pending (Suspense path)', () => {
    let pendingResolve: (() => void) | undefined;
    const pending = new Promise<void>(res => {
      pendingResolve = res;
    });
    let owned!: ReactiveSignal<string | null, []>;
    owned = createReactiveSignal(
      {
        compute: () =>
          runSyncReplayAsyncComponent(
            function* () {
              yield pending;
              return 'nope';
            },
            {},
            owned,
          ),
        equals: () => false,
        isRelay: false,
        tracer: undefined,
      },
      [],
      undefined,
      undefined,
    );
    owned._isLazy = true;
    let thrown: unknown;
    try {
      runSignal(owned);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(pending);
    pendingResolve?.();
  });

  it('after a fulfilled native promise settles, replay injects value synchronously', async () => {
    const p = Promise.resolve(42);
    let owned!: ReactiveSignal<string | null, []>;
    owned = createReactiveSignal(
      {
        compute: () =>
          runSyncReplayAsyncComponent(
            function* () {
              const v = yield p;
              return String(v);
            },
            {},
            owned,
          ),
        equals: () => false,
        isRelay: false,
        tracer: undefined,
      },
      [],
      undefined,
      undefined,
    );
    owned._isLazy = true;
    try {
      runSignal(owned);
    } catch (e) {
      expect(e).toBe(p);
    }
    await Promise.resolve();
    runSignal(owned);
    expect(owned.value).toBe('42');
  });
});
