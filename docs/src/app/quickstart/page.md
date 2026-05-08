---
title: Quick start
---

Signalium is fine-grained reactivity that layers on top of React. You keep writing React the way you already do — JSX, hooks, Suspense, context, everything — and sprinkle in signals where you want granular, automatic updates with no dependency arrays and no selectors.

The whole library is built around one primitive: **`component`**. If you can write a React function component, you already know how to use Signalium.

---

## 1. Install

```bash
npm install signalium
```

Signalium works with any React 19+ app. If you use yarn or pnpm, `yarn add signalium` / `pnpm add signalium` work the same way.

---

## 2. Set up the Babel preset

The preset enables async components and async reactive functions. If you never plan to use `async`/`await` inside a reactive function or component, you can skip this step — but most apps will want it.

### Vite + React

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { signaliumPreset } from 'signalium/transform';

export default defineConfig({
  plugins: [
    react({
      babel: {
        presets: [signaliumPreset()],
      },
    }),
  ],
});
```

### babel.config.js

```js
import { signaliumPreset } from 'signalium/transform';

module.exports = {
  presets: [
    '@babel/preset-env',
    '@babel/preset-react',
    '@babel/preset-typescript',
    signaliumPreset(),
  ],
};
```

See [Bundler setup](/integrating/bundlers) for Next.js, Webpack, Metro (React Native), and more.

---

## 3. Write your first component

Here's a counter that demonstrates the whole Signalium mental model in 10 lines:

```tsx
import { reactive } from 'signalium';
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);
  const doubled = reactive(() => count.value * 2);

  return (
    <div>
      <p>Count: {count.value}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

What's happening:

- **`component(...)`** wraps your function like `React.memo` would, but smarter. It tracks every signal and reactive function you read and re-renders only when those actually change.
- **`useSignal(0)`** is like `useState(0)`, except it returns a stable object with a `.value` property. Reading `count.value` subscribes. Writing `count.value = …` updates.
- **`reactive(() => …)`** is like `useMemo`, except there's no dependency array. Signalium figures out the dependencies from the reads inside the function, caches the result, and re-runs when any of them change.

That's it. You now know enough to start refactoring real components.

---

## 4. Share state between components

The moment state needs to be shared, things usually get awkward in React — you reach for context, or lift state up, or pull in Zustand. With Signalium, you just define the signal at module scope:

```tsx
import { signal, reactive } from 'signalium';
import { component } from 'signalium/react';

const count = signal(0);
const doubled = reactive(() => count.value * 2);

const Display = component(() => <p>Doubled: {doubled()}</p>);

const Incrementer = component(() => (
  <button onClick={() => count.value++}>+1</button>
));
```

Both components read the same `count`. When it updates, only the ones that actually read it re-render. No provider, no selector, no subscription.

{% callout title="One signal, many consumers" %}
Because signals are plain JS values (not hooks), they work anywhere — in route loaders, in worker threads, in tests, or inside other reactive functions. The same `count` signal can be used across your entire app.
{% /callout %}

---

## 5. Async, for real

Mark a reactive function `async` and it returns a **reactive promise** — a promise-like value that's memoized, deduped, and Suspense-ready.

```tsx
import { Suspense } from 'react';
import { reactive } from 'signalium';
import { component } from 'signalium/react';

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

const Profile = component(async ({ id }: { id: string }) => {
  const user = await loadUser(id);
  return <h1>{user.name}</h1>;
});

export default function App() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Profile id="42" />
    </Suspense>
  );
}
```

Signalium's async transform compiles `await` inside `component` into Suspense-friendly code. Call the same `loadUser` from multiple components and it only fetches once. Mutate a signal that `loadUser` depends on and it refetches — everywhere — automatically.

---

## Where to go next

{% quick-links %}

{% quick-link title="Your first component" icon="presets" href="/components/first-component" description="Take a deeper look at component(), useSignal, and the component model." /%}

{% quick-link title="Layering on React" icon="plugins" href="/components/layering" description="Understand how Signalium sits on top of React without replacing it." /%}

{% quick-link title="The reactivity system" icon="installation" href="/reactivity/signals" description="Dive under the hood into signals, reactive functions, relays, and scheduling." /%}

{% quick-link title="Incremental adoption" icon="theming" href="/integrating/existing-apps" description="Bring Signalium into an existing codebase one component at a time." /%}

{% /quick-links %}
