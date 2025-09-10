# Signalium

Granular Signals and Reactive Functions for JavaScript and React — with first-class async, subscriptions, and great DX.

Read the docs at https://signalium.dev for guides, API reference, and examples.

Signalium gives you four composable primitives:

- **Signals**: a mutable value (`signal(0)`)
- **Reactive Functions**: a cached computed (sync or async) that tracks what it reads (`reactive(() => a.value + b.value)`). Async reactives produce a **Reactive Promise**.
- **Relays**: a long-lived reactive for event-like sources (sockets, timers) that activates when watched and tears down when unused
- **Watchers**: an external subscriber that bridges the reactive graph to the outside world

Together these cover local state, derived state, async data, and subscriptions in a single, consistent model.

## Install

```bash
npm install signalium
# or
pnpm add signalium
yarn add signalium
```

React helpers are provided by the same package via a subpath import:

```ts
import { component, useSignal } from 'signalium/react';
```

## Quickstart

### Core (vanilla JS/TS)

```ts
import { signal, reactive } from 'signalium';

const count = signal(0);
const double = reactive(() => count.value * 2);

double(); // 0 (computed and cached)
count.value = 2;
double(); // 4 (recomputed lazily on access)
```

Async reactive functions become Reactive Promises automatically:

```ts
import { reactive } from 'signalium';

const fetchUser = reactive(async (id: string) => {
  const res = await fetch(`https://example.com/users/${id}`);
  return res.json() as Promise<{ id: string; name: string }>;
});

const user = await fetchUser('1');
console.log(user.value); // resolved data
```

Relays handle subscriptions and push-based async:

```ts
import { signal, reactive, relay } from 'signalium';

const url = signal('wss://echo.example');

const messages = reactive(() =>
  relay<string>(state => {
    const socket = new WebSocket(url.value);
    socket.onmessage = e => (state.value = String(e.data));
    socket.onopen = () => socket.send('hello');
    return () => socket.close();
  }),
);

messages(); // Reactive Promise with latest message when ready
```

### React

```tsx
import { component, useSignal } from 'signalium/react';

export const Counter = component(() => {
  const count = useSignal(0);

  return (
    <div>
      <button onClick={() => count.update(v => v - 1)}>-</button>
      <span>{count.value}</span>
      <button onClick={() => count.update(v => v + 1)}>+</button>
    </div>
  );
});
```

Use Reactive Promises directly in components:

```tsx
import { component } from 'signalium/react';
import { reactive } from 'signalium';

const getUser = reactive(async () => {
  const res = await fetch('https://example.com/users/1');
  return res.json() as Promise<{ name: string }>;
});

export const User = component(() => {
  const user = getUser();
  if (user.isPending) return <p>Loading…</p>;
  if (user.error) return <p>Error</p>;
  return <p>{user.value.name}</p>;
});
```

## Why Signalium?

- **Minimal recomputation**: Only the necessary functions rerun, from changed state outward
- **Lazy by default**: Work happens on demand when values are read
- **Event-friendly**: Relays model long-lived, push-based sources cleanly
- **Framework-agnostic core**: Use in Node, workers, scripts, or with React via `signalium/react`
- **TypeScript-first**: Strong, predictable types across the API

## Documentation

Read the full documentation at https://signalium.dev

## License

MIT — see `docs/LICENCE.md` for details.
