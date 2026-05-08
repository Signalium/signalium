---
title: Installation & setup
---

Signalium is a single package with React bindings built in. You don't need a separate `signalium-react`, and you don't need any adapters or middleware.

## Install

```bash
npm install signalium
# or
yarn add signalium
# or
pnpm add signalium
```

## Peer dependency

Signalium supports **React 19+** as an optional peer dependency. You only need React installed if you're using `signalium/react`; the core reactivity engine works in Node, workers, and any JS runtime.

```json
{
  "peerDependencies": {
    "react": ">=19.0.0"
  }
}
```

## Entry points

| Import path           | What you get                                           |
| --------------------- | ------------------------------------------------------ |
| `signalium`           | Core engine: `signal`, `reactive`, `relay`, `context`… |
| `signalium/react`     | React bindings: `component`, `useSignal`, `useReactive`, `ContextProvider`, `PauseSignalsProvider` |
| `signalium/utils`     | Optional helpers                                       |
| `signalium/config`    | `setConfig()` for scheduler / batching customization   |
| `signalium/transform` | Babel preset for async components / reactive functions |

For the full surface, see the [API reference](/api/signalium).

## The Babel preset

Signalium ships a Babel preset that enables two things:

1. `async` functions inside `reactive(...)` and `component(...)` — so you can use real `await` and still get dependency tracking.
2. Implicit wrapping of inline callbacks in `callback(...)` when they cross a reactive boundary.

You can get started without the preset — `signal`, sync `reactive`, and sync `component` all work out of the box. The moment you want async components or reactive fetching, turn it on.

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

### babel.config.js (CRA, Next.js with custom Babel, etc.)

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

For per-bundler instructions (Next.js, Webpack, Metro, esbuild), see [Bundler setup](/integrating/bundlers).

## TypeScript

Signalium is written in TypeScript and ships its own types. No `@types/*` package needed.

```ts
import { signal, reactive, type Signal } from 'signalium';

const count: Signal<number> = signal(0);
const doubled = reactive((c: Signal<number>) => c.value * 2);
```

## Sanity check

Drop this into any React file and run your dev server:

```tsx
import { component, useSignal } from 'signalium/react';

export const HelloSignalium = component(() => {
  const name = useSignal('World');
  return (
    <div>
      <input
        value={name.value}
        onChange={(e) => (name.value = e.target.value)}
      />
      <p>Hello, {name.value}!</p>
    </div>
  );
});
```

If the input updates live as you type without any `onChange` plumbing beyond the assignment — you're set. Jump to [Your first component](/components/first-component).
