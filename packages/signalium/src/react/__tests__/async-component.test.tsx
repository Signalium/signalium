import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import React, { Component, Suspense, use, useState } from 'react';
import { reactive, signal } from 'signalium';
import { component, SIGNALIUM_ASYNC_COMPONENT, throwIfSignaliumAsyncComponentPassedToUse } from 'signalium/react';
import { userEvent } from '@vitest/browser/context';
import { sleep } from '../../__tests__/utils/async.js';

class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode; onError?: () => void },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    if (this.state.err) {
      return this.props.fallback ?? <div data-testid="error">{this.state.err.message}</div>;
    }
    return this.props.children;
  }
}

describe('React > async component()', () => {
  /** No-op async reactive — yields a ReactivePromise, then resolves (primary “tick” for tests). */
  const flush = reactive(async () => {
    await sleep(0);
  });

  test('(sanity) raw thrown Promise works with Suspense', async () => {
    let p: Promise<void> | undefined;
    let done = false;

    function RawChild() {
      if (!done) {
        if (!p) {
          p = Promise.resolve().then(() => {
            done = true;
          });
        }
        throw p;
      }
      return <span data-testid="ready">ok</span>;
    }

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">loading</div>}>
        <RawChild />
      </Suspense>,
    );

    await expect.element(getByTestId('fb')).toBeInTheDocument();
    await expect.element(getByTestId('ready')).toBeInTheDocument();
  });

  test('Suspense + signal read + reactive async computed', async () => {
    const n = signal(0);
    const load = reactive(async () => {
      void n.value;
      await sleep(0);
      return 'ok';
    });
    const Leaf = component(async () => {
      await load();
      return <span data-testid="ready">ok</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">loading</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb')).toBeInTheDocument();
    await sleep(0);
    await expect.element(getByTestId('ready')).toBeInTheDocument();
    await expect.element(getByTestId('fb')).not.toBeInTheDocument();
  });

  test('native Promise delay (stable identity) still completes', async () => {
    const delay = sleep(25);
    const Leaf = component(async () => {
      await delay;
      return <span data-testid="ready2">ok</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb2">loading</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb2')).toBeInTheDocument();
    await expect.element(getByTestId('ready2')).toBeInTheDocument();
  });

  test('two instances with same empty props each run async component body (no cross-instance dedup)', async () => {
    let runs = 0;
    // Fulfilled native promise: one suspend + one replay per instance (see sync replay driver).
    const tick = Promise.resolve();
    const Leaf = component(async () => {
      runs++;
      await tick;
      return <span data-testid="r">x</span>;
    });

    render(
      <Suspense fallback={<div data-testid="fb">wait</div>}>
        <Leaf />
        <Leaf />
      </Suspense>,
    );

    await expect.poll(() => document.querySelectorAll('[data-testid="r"]').length).toBe(2);
    // Each instance replays from the top after Suspense; total runs vary with React version / Strict Mode.
    expect(runs).toBeGreaterThanOrEqual(4);
    expect(runs).toBeLessThanOrEqual(10);
  });

  test('nested async components via reactive computeds', async () => {
    const innerReady = reactive(async () => {
      await sleep(0);
      return 'inner';
    });
    const outerReady = reactive(async () => {
      await sleep(0);
      return 'outer';
    });
    const Inner = component(async () => {
      await innerReady();
      return <i data-testid="inner">in</i>;
    });
    const Outer = component(async () => {
      await outerReady();
      return (
        <div>
          <Inner />
        </div>
      );
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">wait</div>}>
        <Outer />
      </Suspense>,
    );

    await expect.element(getByTestId('inner')).toBeInTheDocument();
  });

  test('nested async with multiple async children (reactives)', async () => {
    const aReady = reactive(async () => {
      await sleep(0);
      return 'a';
    });
    const bReady = reactive(async () => {
      await sleep(0);
      return 'b';
    });
    const parentReady = reactive(async () => {
      await sleep(0);
      return 'p';
    });
    const A = component(async () => {
      await aReady();
      return <span data-testid="a">a</span>;
    });
    const B = component(async () => {
      await bReady();
      return <span data-testid="b">b</span>;
    });
    const Parent = component(async () => {
      await parentReady();
      return (
        <div>
          <A />
          <B />
        </div>
      );
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">wait</div>}>
        <Parent />
      </Suspense>,
    );

    await expect.element(getByTestId('a')).toBeInTheDocument();
    await expect.element(getByTestId('b')).toBeInTheDocument();
  });

  test('async then sync Signalium component then async', async () => {
    const deepReady = reactive(async () => {
      await sleep(0);
      return true;
    });
    const wrapReady = reactive(async () => {
      await sleep(0);
      return true;
    });
    const Inner = component(async () => {
      await deepReady();
      return <b data-testid="inner">deep</b>;
    });
    const Mid = component(() => <Inner />);
    const Outer = component(async () => {
      await wrapReady();
      return <Mid />;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">wait</div>}>
        <Outer />
      </Suspense>,
    );

    await expect.element(getByTestId('inner')).toBeInTheDocument();
  });

  test('zebra: host components interleaved with async components', async () => {
    const bitReady = reactive(async () => {
      await sleep(0);
      return true;
    });
    const AsyncBit = component(async () => {
      await bitReady();
      return <em data-testid="em">e</em>;
    });

    const Shell = () => (
      <div data-testid="shell">
        <span data-testid="s1">1</span>
        <AsyncBit />
        <span data-testid="s2">2</span>
      </div>
    );

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb">wait</div>}>
        <Shell />
      </Suspense>,
    );

    await expect.element(getByTestId('em')).toBeInTheDocument();
    await expect.element(getByTestId('s1')).toBeInTheDocument();
    await expect.element(getByTestId('s2')).toBeInTheDocument();
  });

  test('mixed: reactive async then native Promise in one component', async () => {
    const first = reactive(async () => {
      await sleep(0);
      return 1;
    });
    const nativePause = sleep(8);
    const Leaf = component(async () => {
      await first();
      await nativePause;
      return <span data-testid="mixed">ok</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-mix">wait</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('mixed')).toBeInTheDocument();
  });

  test('reactive async throws after await → error boundary; Suspense not stuck', async () => {
    const failAfterTick = reactive(async () => {
      await sleep(0);
      throw new Error('async-fail');
    });
    const Bad = component(async () => {
      await failAfterTick();
      return null;
    });

    const { getByTestId } = render(
      <ErrorBoundary fallback={<div data-testid="eb">recovered</div>}>
        <Suspense fallback={<div data-testid="fb">loading</div>}>
          <Bad />
        </Suspense>
      </ErrorBoundary>,
    );

    await expect.element(getByTestId('eb')).toBeInTheDocument();
    await expect.element(getByTestId('fb')).not.toBeInTheDocument();
  });

  test('sync throw before first await hits error boundary', async () => {
    const Bad = component(async () => {
      throw new Error('sync-boom');
      await flush();
      return null;
    });

    const { getByTestId } = render(
      <ErrorBoundary fallback={<div data-testid="eb">recovered</div>}>
        <Suspense fallback={<div data-testid="fb">loading</div>}>
          <Bad />
        </Suspense>
      </ErrorBoundary>,
    );

    await expect.element(getByTestId('eb')).toBeInTheDocument();
  });

  test('error boundary retry via remount key allows success on second attempt', async () => {
    let shouldFail = true;
    const Flaky = component(async (props: { attempt: number }) => {
      void props.attempt;
      if (shouldFail) {
        throw new Error('flaky');
      }
      await flush();
      return <div data-testid="ok">fixed</div>;
    });

    const Root = () => {
      const [k, setK] = useState(0);
      return (
        <div>
          <button type="button" data-testid="retry" onClick={() => setK(c => c + 1)}>
            retry
          </button>
          <Suspense key={k} fallback={<div data-testid="fb">loading</div>}>
            <ErrorBoundary
              fallback={
                <div data-testid="eb">
                  <span>err</span>
                </div>
              }
            >
              <Flaky attempt={k} />
            </ErrorBoundary>
          </Suspense>
        </div>
      );
    };

    const { getByTestId } = render(<Root />);

    await expect.element(getByTestId('eb')).toBeInTheDocument();
    shouldFail = false;
    await userEvent.click(getByTestId('retry'));
    await expect.element(getByTestId('ok')).toBeInTheDocument();
  });

  test('inner async rejects inside local ErrorBoundary + Suspense', async () => {
    const innerFail = reactive(async () => {
      await sleep(0);
      throw new Error('inner');
    });
    const Inner = component(async () => {
      await innerFail();
      return null;
    });

    const { getByTestId } = render(
      <ErrorBoundary fallback={<div data-testid="inner-eb">inner-err</div>}>
        <Suspense fallback={<div data-testid="inner-s">in-load</div>}>
          <Inner />
        </Suspense>
      </ErrorBoundary>,
    );

    await expect.element(getByTestId('inner-eb')).toBeInTheDocument();
  });

  test('async outer marks SIGNALIUM_ASYNC_COMPONENT on wrapper', () => {
    const Leaf = component(async () => {
      await flush();
      return null;
    });
    expect((Leaf as { [SIGNALIUM_ASYNC_COMPONENT]?: boolean })[SIGNALIUM_ASYNC_COMPONENT]).toBe(true);
  });

  test('throwIfSignaliumAsyncComponentPassedToUse throws for async component', () => {
    const Leaf = component(async () => {
      await flush();
      return null;
    });
    expect(() => throwIfSignaliumAsyncComponentPassedToUse(Leaf)).toThrow(/not supported/);
  });

  test('sync component() wrapper is not marked async', () => {
    const Leaf = component(() => <div />);
    expect((Leaf as { [SIGNALIUM_ASYNC_COMPONENT]?: boolean })[SIGNALIUM_ASYNC_COMPONENT]).toBeUndefined();
  });

  test('keyed remount runs generator again (new instance / hash)', async () => {
    let runs = 0;
    const Leaf = component(async (props: { id: number }) => {
      void props.id;
      runs++;
      await flush();
      return <span data-testid="rk">k</span>;
    });

    const Root = ({ k }: { k: number }) => (
      <Suspense fallback={<div data-testid="fb-k">wait</div>}>
        <Leaf key={k} id={k} />
      </Suspense>
    );

    const { getByTestId, rerender } = render(<Root k={0} />);
    await expect.element(getByTestId('rk')).toBeInTheDocument();
    expect(runs).toBe(2);

    rerender(<Root k={1} />);
    await expect.element(getByTestId('rk')).toBeInTheDocument();
    expect(runs).toBe(4);
  });

  test('conditional async branch does not leak pending state', async () => {
    const aReady = reactive(async () => {
      await sleep(0);
      return 'a';
    });
    const bReady = reactive(async () => {
      await sleep(0);
      return 'b';
    });
    const A = component(async () => {
      await aReady();
      return <span data-testid="ca">a</span>;
    });
    const B = component(async () => {
      await bReady();
      return <span data-testid="cb">b</span>;
    });

    const Root = ({ useA }: { useA: boolean }) => (
      <Suspense fallback={<div data-testid="fb-sw">wait</div>}>{useA ? <A /> : <B />}</Suspense>
    );

    const { getByTestId, rerender } = render(<Root useA />);
    await expect.element(getByTestId('ca')).toBeInTheDocument();

    rerender(<Root useA={false} />);
    await expect.element(getByTestId('cb')).toBeInTheDocument();
    await expect.element(getByTestId('ca')).not.toBeInTheDocument();
  });

  test('useState after suspending await runs after resume (use-like replay)', async () => {
    let resolveGate: (() => void) | undefined;
    const gate = new Promise<void>(r => {
      resolveGate = r;
    });
    const waitGate = reactive(async () => {
      await gate;
    });
    const Leaf = component(async () => {
      await waitGate();
      const [v] = useState(7);
      return <span data-testid="after-hook">{v}</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-gate">wait</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb-gate')).toBeInTheDocument();
    resolveGate!();
    await expect.element(getByTestId('after-hook')).toHaveTextContent('7');
    await expect.element(getByTestId('fb-gate')).not.toBeInTheDocument();
  });

  test('reactive async: UI stays on Suspense until the computed resolves (not immediate)', async () => {
    const load = reactive(async () => {
      await sleep(45);
      return 'slow-ready';
    });
    const Leaf = component(async () => {
      const text = await load();
      return <span data-testid="slow-out">{text}</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-slow">hold</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb-slow')).toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll('[data-testid="slow-out"]').length).toBe(0);
    await sleep(50);
    await expect.element(getByTestId('slow-out')).toHaveTextContent('slow-ready');
    await expect.element(getByTestId('fb-slow')).not.toBeInTheDocument();
  });

  test('reactive async recomputes when signal changes: new value after async work', async () => {
    const src = signal(1);
    const load = reactive(async () => {
      const base = src.value;
      await sleep(35);
      return `x${base}`;
    });
    const Leaf = component(async () => {
      const text = await load();
      return <span data-testid="sig-out">{text}</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-sig">wait</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb-sig')).toBeInTheDocument();
    await sleep(40);
    await expect.element(getByTestId('sig-out')).toHaveTextContent('x1');
    await expect.element(getByTestId('fb-sig')).not.toBeInTheDocument();

    src.value = 2;
    // Second load runs for the new signal value; fallback may be too brief to assert reliably.
    await expect.poll(() => document.querySelector('[data-testid="sig-out"]')?.textContent).toBe('x2');
  });

  test('parent useState can update while async child is suspended on reactive async', async () => {
    const loadN = reactive(async (n: number) => {
      await sleep(120);
      return `n=${n}`;
    });
    const Leaf = component(async (props: { count: number }) => {
      const label = await loadN(props.count);
      return <span data-testid="child-label">{label}</span>;
    });

    function Root() {
      const [c, setC] = useState(0);
      return (
        <div>
          <span data-testid="parent-c">{c}</span>
          <button type="button" data-testid="parent-inc" onClick={() => setC(x => x + 1)}>
            +
          </button>
          <Suspense fallback={<div data-testid="fb-parent">child-wait</div>}>
            <Leaf count={c} />
          </Suspense>
        </div>
      );
    }

    const { getByTestId } = render(<Root />);

    await expect.element(getByTestId('fb-parent')).toBeInTheDocument();
    await expect.element(getByTestId('parent-c')).toHaveTextContent('0');

    await userEvent.click(getByTestId('parent-inc'));
    await expect.element(getByTestId('parent-c')).toHaveTextContent('1');
    await expect.element(getByTestId('fb-parent')).toBeInTheDocument();

    await sleep(130);
    await expect.element(getByTestId('child-label')).toHaveTextContent('n=1');
    await expect.element(getByTestId('parent-c')).toHaveTextContent('1');
  });

  test('native Promise (non-reactive): no final content until delay elapses', async () => {
    const delay = sleep(40);
    const Leaf = component(async () => {
      await delay;
      return <span data-testid="native-late">native-ok</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-native">native-wait</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb-native')).toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll('[data-testid="native-late"]').length).toBe(0);
    await sleep(45);
    await expect.element(getByTestId('native-late')).toHaveTextContent('native-ok');
  });

  test('native delay: useState before await survives replay and shows after resolve', async () => {
    const delay = sleep(30);
    const Leaf = component(async () => {
      const [v] = useState('kept');
      await delay;
      return <span data-testid="mix-native-state">{v}</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<div data-testid="fb-mix-state">wait</div>}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('fb-mix-state')).toBeInTheDocument();
    await sleep(35);
    await expect.element(getByTestId('mix-native-state')).toHaveTextContent('kept');
  });

  test('chained reactive async computeds: single outer Suspense wait (one fallback mount)', async () => {
    let fallbackMounts = 0;
    function Fallback() {
      fallbackMounts++;
      return <div data-testid="fb-my">loading</div>;
    }
    const step1 = reactive(async () => {
      await sleep(0);
      return 1;
    });
    const step2 = reactive(async () => {
      await sleep(5);
      return 2;
    });
    const Leaf = component(async () => {
      await step1();
      await step2();
      return <span data-testid="my-done">ok</span>;
    });

    const { getByTestId } = render(
      <Suspense fallback={<Fallback />}>
        <Leaf />
      </Suspense>,
    );

    await expect.element(getByTestId('my-done')).toBeInTheDocument();
    expect(fallbackMounts).toBe(1);
  });
});

describe.skipIf(typeof use !== 'function')('React > async component() + use() (React 19+)', () => {
  test('use(promise) alongside async Signalium child', async () => {
    const p = Promise.resolve(42);
    const tick = reactive(async () => {
      await sleep(0);
      return true;
    });
    const Child = component(async () => {
      await tick();
      return <span data-testid="async-child">child</span>;
    });

    function Parent() {
      const n = use(p);
      return (
        <div>
          <span data-testid="use-val">{n}</span>
          <Suspense fallback={<div data-testid="fb">wait</div>}>
            <Child />
          </Suspense>
        </div>
      );
    }

    render(
      <Suspense fallback={<div data-testid="fb-use-root">use-root</div>}>
        <Parent />
      </Suspense>,
    );
    await expect.poll(() => document.querySelector('[data-testid="use-val"]')?.textContent).toBe('42');
    await expect.poll(() => document.querySelectorAll('[data-testid="async-child"]').length).toBe(1);
  });
});
