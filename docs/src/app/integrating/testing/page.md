---
title: Testing
---

Testing Signalium code is mostly testing React — components render through React's normal tree, so React Testing Library, Jest, and Vitest all work unmodified. The Signalium-specific pieces are:

- **`settled()`** to flush pending async reactive work.
- **Contexts + `ContextProvider`** for injecting mock clients.
- **`<ContextProvider inherit={false}>`** for isolating a test from any global reactive state.
- **Mocking relays** by swapping the relay's source or by using context injection.

This page walks through the common patterns.

## Setup

No special adapter is required. Install whatever test runner you like:

```bash
npm install -D @testing-library/react @testing-library/jest-dom jsdom vitest
```

If you're using Vitest:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { signaliumPreset } from 'signalium/transform';

export default defineConfig({
  plugins: [
    react({
      babel: { presets: [signaliumPreset()] },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

Include the Babel preset if your code uses `component(async ...)` or `reactive(async ...)`. Otherwise it's optional.

## Testing a component

A `component(...)` is a React function component — render it with `@testing-library/react` and assert on the output:

```tsx
// counter.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);
  return (
    <div>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});

it('increments', () => {
  render(<Counter />);
  expect(screen.getByText('Count: 0')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

Nothing Signalium-specific so far. The signal update flushes synchronously on the click handler, React re-renders, and the assertion passes.

## Flushing async reactive work with `settled()`

When reactive functions are async (for example, a `reactive(async ...)` that fetches data), the React render happens before the promise resolves. To advance the reactive graph and let React re-render with the resolved value, use `settled()` from `signalium`:

```tsx
import { render, screen } from '@testing-library/react';
import { reactive } from 'signalium';
import { settled } from 'signalium';
import { component } from 'signalium/react';

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

const UserCard = component(async ({ id }: { id: string }) => {
  const user = await loadUser(id);
  return <p>{user.name}</p>;
});

it('renders the user name once loaded', async () => {
  // Arrange: mock fetch
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ name: 'Ada Lovelace' }),
  });

  render(
    <Suspense fallback={<p>Loading…</p>}>
      <UserCard id="1" />
    </Suspense>,
  );

  expect(screen.getByText('Loading…')).toBeInTheDocument();

  await settled();

  expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
});
```

`settled()` returns a promise that resolves when the Signalium scheduler has no more pending work. Combine it with `findByText` or Testing Library's `waitFor` for cases where React still needs to commit after the reactive work finishes.

## Injecting mock clients via context

Signalium contexts are a clean way to inject a fake service into reactive code for testing. The production code reads `getContext(ApiCtx)`; tests wrap the rendered component in a `ContextProvider` with a mock.

```ts
// app/lib/api.ts
import { context, getContext, reactive } from 'signalium';

export interface ApiClient {
  fetchJSON(path: string): Promise<unknown>;
}

export const ApiCtx = context<ApiClient | null>(null);

export const loadUser = reactive(async (id: string) => {
  const api = getContext(ApiCtx);
  if (!api) throw new Error('ApiClient not provided');
  return api.fetchJSON(`/users/${id}`);
});
```

```tsx
// tests/user-card.test.tsx
import { render, screen } from '@testing-library/react';
import { ContextProvider } from 'signalium/react';
import { settled } from 'signalium';
import { ApiCtx, ApiClient } from '@/lib/api';
import { UserCard } from '@/ui/user-card';

function renderWithApi(ui: React.ReactNode, api: ApiClient) {
  return render(
    <ContextProvider contexts={[[ApiCtx, api]]} inherit={false}>
      <Suspense fallback={<p>Loading…</p>}>{ui}</Suspense>
    </ContextProvider>,
  );
}

it('renders the user name', async () => {
  const api: ApiClient = {
    fetchJSON: vi.fn().mockResolvedValue({ name: 'Grace Hopper' }),
  };

  renderWithApi(<UserCard id="1" />, api);
  await settled();

  expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
  expect(api.fetchJSON).toHaveBeenCalledWith('/users/1');
});
```

Same pattern works for any injectable: a `ClockCtx` with a fake `now()`, a `RandomCtx` with a seeded PRNG, a `RouterCtx` with a mock router — anything you'd normally reach for DI to test.

## Isolating tests with `inherit={false}`

By default, `ContextProvider` inherits from the surrounding scope. In tests, you usually want *full isolation* — no leaked signals or contexts from one test to another. Passing `inherit={false}` makes the provider an isolated root:

```tsx
<ContextProvider contexts={[[ApiCtx, fakeApi]]} inherit={false}>
  <MyComponent />
</ContextProvider>
```

This creates a fresh reactive scope for the subtree: reactive functions re-evaluate inside the scope, no state from a previous test bleeds in, and the scope is discarded when the render tree unmounts. For test suites that run many tests in parallel (Vitest with `--threads`, Jest with workers), this is the cleanest way to guarantee independence.

If you have many tests that need the same setup, a helper keeps tests tidy:

```tsx
// tests/helpers/render.tsx
import { render } from '@testing-library/react';
import { ContextProvider } from 'signalium/react';

export function renderIsolated(
  ui: React.ReactNode,
  contexts: Array<[any, any]> = [],
) {
  return render(
    <ContextProvider contexts={contexts} inherit={false}>
      {ui}
    </ContextProvider>,
  );
}
```

Then each test just calls `renderIsolated(<MyUI />, [[ApiCtx, fakeApi]])`.

## Testing module-scoped signals

Signals defined at module scope persist across tests because the module itself is loaded once per test worker. You have two options:

### Option A: reset signals in `beforeEach`

```ts
import { beforeEach } from 'vitest';
import { sidebarOpen, selectedItem } from '@/state/ui';

beforeEach(() => {
  sidebarOpen.value = false;
  selectedItem.value = null;
});
```

Explicit, no magic. Works fine for a handful of signals.

### Option B: move shared state behind a context

If there's enough state that resetting is tedious, lift it behind a Signalium context. Tests provide a fresh instance per render:

```ts
// app/state/ui.ts
import { context, signal } from 'signalium';

export function createUIState() {
  return {
    sidebarOpen: signal(false),
    selectedItem: signal<string | null>(null),
  };
}

export const UICtx = context<ReturnType<typeof createUIState>>(createUIState());
```

```tsx
// tests/...
renderIsolated(<MyUI />, [[UICtx, createUIState()]]);
```

Each test gets its own UI state. No `beforeEach`.

## Mocking relays

Relays wrap external subscriptions. In tests, you can swap the relay's source in a few ways.

### By context injection

The cleanest approach: define the relay so it reads its source from a context. The real implementation uses a WebSocket, the test provides a scripted stream.

```ts
// app/realtime.ts
import { context, getContext, relay } from 'signalium';

export interface MessageSource {
  subscribe(onMessage: (m: Message) => void): () => void;
}

export const MessageSourceCtx = context<MessageSource | null>(null);

export const messageStream = relay<Message[]>((state) => {
  const source = getContext(MessageSourceCtx);
  if (!source) throw new Error('MessageSource not provided');

  state.value = [];
  return source.subscribe((msg) => {
    state.value = [...state.value, msg];
  });
});
```

```tsx
// tests/chat.test.tsx
function fakeSource(): MessageSource & { send: (m: Message) => void } {
  let listener: ((m: Message) => void) | null = null;
  return {
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    send(m) { listener?.(m); },
  };
}

it('adds incoming messages to the list', async () => {
  const src = fakeSource();
  renderIsolated(<ChatScreen />, [[MessageSourceCtx, src]]);

  await settled();
  expect(screen.queryByText('Hello')).toBeNull();

  src.send({ id: '1', body: 'Hello' });
  await settled();

  expect(screen.getByText('Hello')).toBeInTheDocument();
});
```

This is the most flexible approach — tests drive the relay via the fake source, and nothing else in the code path changes.

### By mocking the underlying primitive

If the relay directly uses a global (e.g. `new WebSocket(...)`), a test-time `vi.stubGlobal('WebSocket', FakeWebSocket)` works for a quick mock but couples tests to the global. Prefer context injection unless the relay is already written in a way you can't easily change.

### By triggering signals manually

A relay is really just a signal whose setup is driven by `state.value = ...` from inside its body. You can always test the *consumers* of a relay without mocking the relay itself by driving the relay's output through a test-only signal that feeds into the same computation:

```ts
// Test-only wrapper
const fakeMessages = signal<Message[]>([]);
export const messageStreamForTests = reactive(() => fakeMessages.value);
```

This is usually a sign the relay should have been built around a context in the first place.

## Testing components that use signals passed as props

Signals are plain JavaScript objects, so a test can pass them directly:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { signal } from 'signalium';
import { component } from 'signalium/react';

const Label = component(({ text }: { text: ReturnType<typeof signal<string>> }) => (
  <p>{text.value}</p>
));

it('reflects the signal value', () => {
  const text = signal('hello');
  render(<Label text={text} />);
  expect(screen.getByText('hello')).toBeInTheDocument();

  text.value = 'updated';
  expect(screen.getByText('updated')).toBeInTheDocument();
});
```

Updating the signal after render triggers a re-render automatically. No `act(...)` wrapping needed — `useSyncExternalStore` integrates with React's scheduler correctly.

## Testing reactive functions in isolation

You can also test a pure `reactive(...)` function without rendering any React. Drive its inputs with signals, call it, and assert on the result:

```ts
import { signal, reactive } from 'signalium';
import { settled } from 'signalium';

it('computes the total from line items', async () => {
  const items = signal<LineItem[]>([{ price: 10, qty: 2 }, { price: 5, qty: 3 }]);
  const total = reactive(() =>
    items.value.reduce((sum, i) => sum + i.price * i.qty, 0),
  );

  expect(total()).toBe(35);

  items.value = [...items.value, { price: 100, qty: 1 }];
  await settled();

  expect(total()).toBe(135);
});
```

For async reactive functions, `await settled()` waits for the graph to quiesce:

```ts
import { reactive, signal, settled } from 'signalium';

it('refetches when the query changes', async () => {
  const query = signal('hello');
  const search = reactive(async (q: Signal<string>) => {
    const res = await fetch(`/api/search?q=${q.value}`);
    return res.json();
  });

  const first = search(query);
  await first;

  query.value = 'world';
  await settled();
  const second = search(query);

  expect(second.isReady).toBe(true);
});
```

## Fake timers and `settled()`

When using `vi.useFakeTimers()` or `jest.useFakeTimers()`, remember that `settled()` still needs the microtask queue to drain. A typical pattern:

```ts
import { settled } from 'signalium';

it('updates after the debounce', async () => {
  vi.useFakeTimers();

  const query = signal('');
  // …render component that debounces and updates a reactive…

  query.value = 'abc';
  vi.advanceTimersByTime(300);
  await settled();

  expect(/* result */).toBe('…');
});
```

Advance timers first to trigger the debounced work, then `await settled()` to let reactive updates propagate.

## Snapshot testing

Snapshot testing works as usual. Just be aware that signal identities are stable across renders, so if a component's output includes a signal reference (rare but possible), the snapshot serializer might render it as `[object Object]`. If that happens, pass `.value` in your assertion or configure a custom serializer for your signal wrapper.

## Checklist

- Use `@testing-library/react` for component rendering — no Signalium-specific harness needed.
- `await settled()` before asserting on reactive async work.
- Wrap tests in `<ContextProvider inherit={false}>` for isolation.
- Inject mock clients and sources via Signalium contexts.
- Reset module-scoped signals in `beforeEach`, or lift them into a context to avoid manual resets.

## Next steps

- [Contexts](/reactivity/contexts) — the full reference for `context`, `getContext`, and `withContexts`.
- [Relays](/reactivity/relays) — the primitive for bridging external subscriptions, and how to make them testable.
- [Scheduling & batching](/reactivity/scheduling) — what `settled()` actually waits on.
- [Incremental adoption](/integrating/existing-apps) — patterns for introducing signals without breaking your test suite.
