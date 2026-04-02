import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { signal, reactive } from 'signalium';
import { component, useSignal } from 'signalium/react';
import React, { Suspense } from 'react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';

describe('React > Async Components', () => {
  test('basic Suspense: shows fallback then resolved content', async () => {
    const AsyncComp = component(async () => {
      await sleep(100);
      return <div>Loaded</div>;
    });

    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <AsyncComp />
      </Suspense>,
    );

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Loaded')).toBeInTheDocument();
  });

  test('reads reactive signals before await', async () => {
    const name = signal('World');

    const AsyncComp = component(async () => {
      const n = name.value;
      await sleep(100);
      return <div>Hello, {n}</div>;
    });

    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <AsyncComp />
      </Suspense>,
    );

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Hello, World')).toBeInTheDocument();

    name.value = 'Universe';
    await expect.element(getByText('Hello, Universe')).toBeInTheDocument();
  });

  test('hooks work before await', async () => {
    const AsyncComp = component(async () => {
      const count = useSignal(0);

      await sleep(100);

      return (
        <div>
          <span>Count: {count.value}</span>
          <button onClick={() => count.value++}>Inc</button>
        </div>
      );
    });

    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <AsyncComp />
      </Suspense>,
    );

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('Count: 0')).toBeInTheDocument();
  });

  test('awaits reactive async functions', async () => {
    const id = signal('a');

    const fetchData = reactive(async (key: string) => {
      await sleep(100);
      return `data-${key}`;
    });

    const AsyncComp = component(async () => {
      const result = await fetchData(id.value);
      return <div>{result}</div>;
    });

    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <AsyncComp />
      </Suspense>,
    );

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('data-a')).toBeInTheDocument();

    id.value = 'b';
    await expect.element(getByText('data-b')).toBeInTheDocument();
  });

  test('updates when dep changes with new async value', async () => {
    const id = signal('a');

    const fetchData = reactive(async (key: string) => {
      await sleep(100);
      return `data-${key}`;
    });

    const AsyncComp = component(async () => {
      const result = await fetchData(id.value);
      return <div>{result}</div>;
    });

    const { getByText } = render(
      <Suspense fallback={<div>Loading...</div>}>
        <AsyncComp />
      </Suspense>,
    );

    await expect.element(getByText('Loading...')).toBeInTheDocument();
    await expect.element(getByText('data-a')).toBeInTheDocument();

    id.value = 'b';
    await expect.element(getByText('data-b')).toBeInTheDocument();
  });

  test('sync component still works after refactor', async () => {
    const text = signal('Hello');

    const SyncComp = component(() => <div>{text.value}</div>);

    const { getByText } = render(<SyncComp />);

    await expect.element(getByText('Hello')).toBeInTheDocument();

    text.value = 'World';
    await expect.element(getByText('World')).toBeInTheDocument();
  });

  // =========================================================================
  // Post-settle single triggers
  // =========================================================================

  describe('post-settle triggers', () => {
    test('useSignal triggers rerun after settle', async () => {
      const AsyncComp = component(async () => {
        const count = useSignal(0);
        const val = count.value;

        await sleep(50);

        return (
          <div>
            <span>val:{val}</span>
            <button onClick={() => count.value++}>bump</button>
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('val:0')).toBeInTheDocument();

      await userEvent.click(getByText('bump'));
      await expect.element(getByText('val:1')).toBeInTheDocument();

      await userEvent.click(getByText('bump'));
      await expect.element(getByText('val:2')).toBeInTheDocument();
    });

    test('external signal triggers rerun after settle', async () => {
      const ext = signal('A');

      const AsyncComp = component(async () => {
        const v = ext.value;
        await sleep(50);
        return <div>ext:{v}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('ext:A')).toBeInTheDocument();

      ext.value = 'B';
      await expect.element(getByText('ext:B')).toBeInTheDocument();

      ext.value = 'C';
      await expect.element(getByText('ext:C')).toBeInTheDocument();
    });

    test('useSignal and signal change simultaneously after settle', async () => {
      const ext = signal('X');

      const AsyncComp = component(async () => {
        const local = useSignal(0);
        const localVal = local.value;
        const extVal = ext.value;

        await sleep(50);

        return (
          <div>
            <span>
              combo:{localVal}-{extVal}
            </span>
            <button
              onClick={() => {
                local.value++;
                ext.value = ext.value === 'X' ? 'Y' : 'X';
              }}
            >
              both
            </button>
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('combo:0-X')).toBeInTheDocument();

      await userEvent.click(getByText('both'));
      await expect.element(getByText('combo:1-Y')).toBeInTheDocument();

      await userEvent.click(getByText('both'));
      await expect.element(getByText('combo:2-X')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Mid-flight triggers (changes while initial load is pending)
  // =========================================================================

  describe('mid-flight triggers', () => {
    test('signal change during initial Suspense resolves to latest value', async () => {
      const ext = signal('first');

      const AsyncComp = component(async () => {
        const v = ext.value;
        await sleep(100);
        return <div>got:{v}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Change signal while the first await is still pending
      await sleep(30);
      ext.value = 'second';

      await expect.element(getByText('got:second')).toBeInTheDocument();
    });

    test('rapid signal changes during initial Suspense settles to last value', async () => {
      const ext = signal('a');

      const AsyncComp = component(async () => {
        const v = ext.value;
        await sleep(80);
        return <div>rapid:{v}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Fire several rapid updates while the component is still suspended
      await sleep(10);
      ext.value = 'b';
      await sleep(10);
      ext.value = 'c';
      await sleep(10);
      ext.value = 'd';

      await expect.element(getByText('rapid:d')).toBeInTheDocument();
    });

    test('signal change from sibling during Suspense', async () => {
      const shared = signal('init');

      const AsyncComp = component(async () => {
        const v = shared.value;
        await sleep(100);
        return <div>async:{v}</div>;
      });

      const Sibling = () => <button onClick={() => (shared.value = 'updated')}>update-from-sibling</button>;

      const { getByText } = render(
        <div>
          <Sibling />
          <Suspense fallback={<div>Loading...</div>}>
            <AsyncComp />
          </Suspense>
        </div>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Sibling triggers a shared signal change while async is pending
      await userEvent.click(getByText('update-from-sibling'));

      await expect.element(getByText('async:updated')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Rapid re-triggers after settle
  // =========================================================================

  describe('rapid re-triggers after settle', () => {
    test('multiple rapid signal changes after settle shows last value', async () => {
      const ext = signal('start');

      const AsyncComp = component(async () => {
        const v = ext.value;
        await sleep(50);
        return <div>v:{v}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('v:start')).toBeInTheDocument();

      // Rapid-fire changes
      ext.value = 'a';
      ext.value = 'b';
      ext.value = 'c';
      ext.value = 'final';

      await expect.element(getByText('v:final')).toBeInTheDocument();
    });

    test('signal change while previous revalidation is in-flight skips intermediate', async () => {
      const ext = signal('1');

      const fetchData = reactive(async (key: string) => {
        await sleep(80);
        return `fetched-${key}`;
      });

      const AsyncComp = component(async () => {
        const result = await fetchData(ext.value);
        return <div>{result}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('fetched-1')).toBeInTheDocument();

      // Start a revalidation
      ext.value = '2';

      // Before it finishes (~80ms), change again
      await sleep(20);
      ext.value = '3';

      // Should skip '2' and end up on '3'
      await expect.element(getByText('fetched-3')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Mixed async and sync dependencies
  // =========================================================================

  describe('mixed dependencies', () => {
    test('sync dep before await + async dep after await update independently', async () => {
      const syncDep = signal('sync-A');
      const asyncInput = signal('x');

      const fetchData = reactive(async (key: string) => {
        await sleep(60);
        return `async-${key}`;
      });

      const AsyncComp = component(async () => {
        const s = syncDep.value;
        const a = await fetchData(asyncInput.value);
        return (
          <div>
            mixed:{s}/{a}
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('mixed:sync-A/async-x')).toBeInTheDocument();

      // Change only the sync dep
      syncDep.value = 'sync-B';
      await expect.element(getByText('mixed:sync-B/async-x')).toBeInTheDocument();

      // Change only the async dep
      asyncInput.value = 'y';
      await expect.element(getByText('mixed:sync-B/async-y')).toBeInTheDocument();
    });

    test('useSignal + external signal + awaited reactive all update correctly', async () => {
      const ext = signal('E');
      const asyncInput = signal('1');

      const fetchData = reactive(async (key: string) => {
        await sleep(50);
        return `f(${key})`;
      });

      const AsyncComp = component(async () => {
        const local = useSignal('L');
        const localVal = local.value;
        const extVal = ext.value;
        const asyncVal = await fetchData(asyncInput.value);

        return (
          <div>
            <span>
              triple:{localVal}/{extVal}/{asyncVal}
            </span>
            <button onClick={() => (local.value = 'L2')}>setLocal</button>
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('triple:L/E/f(1)')).toBeInTheDocument();

      // Change useSignal via button
      await userEvent.click(getByText('setLocal'));
      await expect.element(getByText('triple:L2/E/f(1)')).toBeInTheDocument();

      // Change external signal
      ext.value = 'E2';
      await expect.element(getByText('triple:L2/E2/f(1)')).toBeInTheDocument();

      // Change async input
      asyncInput.value = '2';
      await expect.element(getByText('triple:L2/E2/f(2)')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    test('async component error is captured on the ReactivePromise', async () => {
      const shouldFail = signal(true);

      const fetchData = reactive(async (fail: boolean) => {
        await sleep(50);
        if (fail) throw new Error('boom');
        return 'ok';
      });

      // Use a sync component wrapper to observe the ReactivePromise state
      // since error boundary integration with async component generators is
      // not yet supported (the retry loop prevents errors from surfacing to
      // React's ErrorBoundary).
      const Wrapper = component(() => {
        const result = fetchData(shouldFail.value);

        if (result.isPending) return <div>Loading...</div>;
        if (result.isRejected) return <div>error:{(result.error as Error).message}</div>;
        return <div>ok:{result.value}</div>;
      });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getByText } = render(<Wrapper />);

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('error:boom')).toBeInTheDocument();

      spy.mockRestore();
    });

    test('recovery after error when dep changes to non-throwing value', async () => {
      const shouldFail = signal(true);

      const fetchData = reactive(async (fail: boolean) => {
        await sleep(50);
        if (fail) throw new Error('oops');
        return 'recovered';
      });

      const Wrapper = component(() => {
        const result = fetchData(shouldFail.value);

        if (result.isPending) return <div>Loading...</div>;
        if (result.isRejected) return <div>error:{(result.error as Error).message}</div>;
        return <div>ok:{result.value}</div>;
      });

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getByText } = render(<Wrapper />);

      await expect.element(getByText('error:oops')).toBeInTheDocument();

      // Fix the dep — the reactive should re-run and succeed
      shouldFail.value = false;
      await expect.element(getByText('ok:recovered')).toBeInTheDocument();

      spy.mockRestore();
    });
  });

  // =========================================================================
  // Conditional await paths
  // =========================================================================

  describe('conditional await paths', () => {
    test('component toggles between sync return and async await without getting stuck', async () => {
      const useAsync = signal(true);

      const AsyncComp = component(async () => {
        const isAsync = useAsync.value;

        if (isAsync) {
          await sleep(50);
          return <div>async-path</div>;
        }

        return <div>sync-path</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('async-path')).toBeInTheDocument();

      // Switch to sync path
      useAsync.value = false;
      await expect.element(getByText('sync-path')).toBeInTheDocument();

      // Switch back to async
      useAsync.value = true;
      await expect.element(getByText('async-path')).toBeInTheDocument();

      // And back to sync again
      useAsync.value = false;
      await expect.element(getByText('sync-path')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Nested async components
  // =========================================================================

  describe('nested async components', () => {
    test('parent and child async components resolve independently', async () => {
      const parentInput = signal('P');
      const childInput = signal('C');

      const Child = component(async () => {
        const v = childInput.value;
        await sleep(50);
        return <span>child:{v}</span>;
      });

      const Parent = component(async () => {
        const v = parentInput.value;
        await sleep(50);
        return (
          <div>
            <span>parent:{v}</span>
            <Suspense fallback={<span>child-loading</span>}>
              <Child />
            </Suspense>
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>parent-loading</div>}>
          <Parent />
        </Suspense>,
      );

      await expect.element(getByText('parent-loading')).toBeInTheDocument();
      await expect.element(getByText('parent:P')).toBeInTheDocument();
      await expect.element(getByText('child:C')).toBeInTheDocument();

      // Change only parent dep
      parentInput.value = 'P2';
      await expect.element(getByText('parent:P2')).toBeInTheDocument();
      await expect.element(getByText('child:C')).toBeInTheDocument();

      // Change only child dep
      childInput.value = 'C2';
      await expect.element(getByText('parent:P2')).toBeInTheDocument();
      await expect.element(getByText('child:C2')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Timing stress tests
  // =========================================================================

  describe('timing stress', () => {
    test('alternating signal values do not cause infinite loop', async () => {
      const toggle = signal(false);

      let runCount = 0;

      const AsyncComp = component(async () => {
        runCount++;
        const v = toggle.value;
        await sleep(30);
        return <div>toggle:{String(v)}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('toggle:false')).toBeInTheDocument();

      toggle.value = true;
      await expect.element(getByText('toggle:true')).toBeInTheDocument();

      toggle.value = false;
      await expect.element(getByText('toggle:false')).toBeInTheDocument();

      toggle.value = true;
      await expect.element(getByText('toggle:true')).toBeInTheDocument();

      expect(runCount).toBeLessThan(20);
    });

    test('very fast settle (microtask-level await) works', async () => {
      const ext = signal('fast');

      const AsyncComp = component(async () => {
        const v = ext.value;
        await Promise.resolve();
        return <div>fast:{v}</div>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('fast:fast')).toBeInTheDocument();

      ext.value = 'fast2';
      await expect.element(getByText('fast:fast2')).toBeInTheDocument();
    });

    test('multiple sequential awaits within a single component', async () => {
      const input = signal('a');

      const step1 = reactive(async (key: string) => {
        await sleep(30);
        return `s1(${key})`;
      });

      const step2 = reactive(async (key: string) => {
        await sleep(30);
        return `s2(${key})`;
      });

      const AsyncComp = component(async () => {
        const k = input.value;
        const r1 = await step1(k);
        const r2 = await step2(r1);
        return (
          <div>
            chain:{r1}/{r2}
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <AsyncComp />
        </Suspense>,
      );

      await expect.element(getByText('chain:s1(a)/s2(s1(a))')).toBeInTheDocument();

      input.value = 'b';
      await expect.element(getByText('chain:s1(b)/s2(s1(b))')).toBeInTheDocument();
    });

    test('dependency invalidation during multi-step async resolution', async () => {
      const userId = signal('alice');

      const fetchUser = reactive(async (id: string) => {
        await sleep(40);
        return { id, name: id === 'alice' ? 'Alice' : 'Bob' };
      });

      const fetchPosts = reactive(async (userName: string) => {
        await sleep(60);
        return `${userName}'s posts`;
      });

      const Profile = component(async () => {
        const user = await fetchUser(userId.value);
        const posts = await fetchPosts(user.name);
        return (
          <div>
            profile:{user.name}/{posts}
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <Profile />
        </Suspense>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText("profile:Alice/Alice's posts")).toBeInTheDocument();

      // While the component is settled, change the userId.
      // This invalidates fetchUser, which cascades to fetchPosts.
      userId.value = 'bob';
      await expect.element(getByText("profile:Bob/Bob's posts")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Suspense boundary scenarios
  // =========================================================================

  describe('suspense boundary scenarios', () => {
    test('multiple async siblings under one Suspense boundary', async () => {
      const Fast = component(async () => {
        await sleep(30);
        return <span>fast-done</span>;
      });

      const Slow = component(async () => {
        await sleep(100);
        return <span>slow-done</span>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <Fast />
          <Slow />
        </Suspense>,
      );

      // Fallback stays until ALL siblings resolve
      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Both appear together once the slow one finishes
      await expect.element(getByText('fast-done')).toBeInTheDocument();
      await expect.element(getByText('slow-done')).toBeInTheDocument();
    });

    test('normal React Suspense component alongside async Signalium component', async () => {
      // Standard React pattern: external cache + thrown promise
      let resolveVanilla: (v: string) => void;
      const vanillaPromise = new Promise<string>(r => {
        resolveVanilla = r;
      });
      let vanillaResult: string | undefined;

      const VanillaComp = () => {
        if (vanillaResult === undefined) {
          throw vanillaPromise;
        }
        return <span>vanilla:{vanillaResult}</span>;
      };

      vanillaPromise.then(v => {
        vanillaResult = v;
      });

      const SignaliumComp = component(async () => {
        await sleep(50);
        return <span>signalium:done</span>;
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <VanillaComp />
          <SignaliumComp />
        </Suspense>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Resolve the vanilla promise after the Signalium one has had time to settle
      await sleep(100);
      resolveVanilla!('hello');

      await expect.element(getByText('vanilla:hello')).toBeInTheDocument();
      await expect.element(getByText('signalium:done')).toBeInTheDocument();
    });

    test('parent/child async components under same Suspense boundary (serial resolution)', async () => {
      const parentInput = signal('P');
      const childInput = signal('C');

      const Child = component(async () => {
        const v = childInput.value;
        await sleep(50);
        return <span>child:{v}</span>;
      });

      // Parent renders child directly — no inner Suspense boundary.
      // The child suspends after the parent resolves, keeping the
      // outer fallback visible until both have settled.
      const Parent = component(async () => {
        const v = parentInput.value;
        await sleep(50);
        return (
          <div>
            <span>parent:{v}</span>
            <Child />
          </div>
        );
      });

      const { getByText } = render(
        <Suspense fallback={<div>Loading...</div>}>
          <Parent />
        </Suspense>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Both parent and child eventually render
      await expect.element(getByText('parent:P')).toBeInTheDocument();
      await expect.element(getByText('child:C')).toBeInTheDocument();

      // Changes propagate through
      parentInput.value = 'P2';
      await expect.element(getByText('parent:P2')).toBeInTheDocument();

      childInput.value = 'C2';
      await expect.element(getByText('child:C2')).toBeInTheDocument();
    });
  });
});
