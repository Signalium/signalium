---
title: Incremental adoption
---

Signalium is designed to be adopted one component at a time. You do not need to switch build tools, rewrite your state layer, or introduce a new root provider. `component(...)`-wrapped components and plain React function components share the same tree, pass the same props, and render through the same React reconciler.

This page walks through the practical patterns for bringing Signalium into an existing React codebase — what to convert first, how to share state across the boundary, and how to avoid the trap of a "big-bang rewrite."

## The only baseline requirement

Install the package and you're ready.

```bash
npm install signalium
```

You do not need the Babel preset unless you want to author `component(async () => { await ... })` or `reactive(async () => { await ... })`. Synchronous components, signals, and reactive functions all work without any build-time transform. See [Bundler setup](/integrating/bundlers) for when and how to enable the preset.

## Where to start

The best first conversion is a component that already hurts. Candidates:

- A form with lots of `useState`s, each feeding into several `useMemo`s.
- A list that renders hundreds of items, each doing its own `React.memo` dance.
- A settings panel whose child components all re-render every time a parent updates.
- A derived value you keep having to recompute with increasingly long dependency arrays.

Don't start with your root layout. Start with a leaf that you can convert in isolation, ship, and verify. Nothing else has to change.

## Pattern 1: Convert one component in place

Take a component, wrap its function in `component(...)`, and swap `useState` for `useSignal`, `useMemo` for `reactive`.

Before:

```tsx
import { useState, useMemo } from 'react';

function PriceLabel({ basePrice }: { basePrice: number }) {
  const [quantity, setQuantity] = useState(1);
  const [discount, setDiscount] = useState(0);
  const total = useMemo(
    () => basePrice * quantity * (1 - discount),
    [basePrice, quantity, discount],
  );

  return (
    <div>
      <input
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
      />
      <input
        type="number"
        value={discount}
        onChange={(e) => setDiscount(Number(e.target.value))}
      />
      <p>Total: {total}</p>
    </div>
  );
}
```

After:

```tsx
import { component, useSignal } from 'signalium/react';
import { reactive } from 'signalium';

const PriceLabel = component(({ basePrice }: { basePrice: number }) => {
  const quantity = useSignal(1);
  const discount = useSignal(0);
  const total = reactive(
    () => basePrice * quantity.value * (1 - discount.value),
  );

  return (
    <div>
      <input
        type="number"
        value={quantity.value}
        onChange={(e) => (quantity.value = Number(e.target.value))}
      />
      <input
        type="number"
        value={discount.value}
        onChange={(e) => (discount.value = Number(e.target.value))}
      />
      <p>Total: {total()}</p>
    </div>
  );
});
```

The parent doesn't know it changed. It still passes `basePrice` as a prop; it still re-renders `PriceLabel` on its own re-renders, but `PriceLabel` skips re-rendering when its props are structurally equivalent and nothing tracked changed. Dependency arrays are gone.

## Pattern 2: Hoist state to a module-scoped signal

The win compounds when two components in different subtrees need the same state. With hooks you reach for context. With Signalium you often don't — a module-scoped signal works anywhere.

```ts
// app/state/cart.ts
import { signal, reactive } from 'signalium';

export const cartItems = signal<CartItem[]>([]);

export const cartTotal = reactive(() =>
  cartItems.value.reduce((sum, item) => sum + item.price * item.quantity, 0),
);

export function addToCart(item: CartItem) {
  cartItems.value = [...cartItems.value, item];
}
```

```tsx
import { component } from 'signalium/react';
import { cartItems, cartTotal, addToCart } from '@/state/cart';

export const CartBadge = component(() => (
  <span className="badge">{cartItems.value.length}</span>
));

export const CartSummary = component(() => (
  <div>
    <h2>Cart</h2>
    <p>Items: {cartItems.value.length}</p>
    <p>Total: ${cartTotal()}</p>
  </div>
));

export const AddButton = component(({ item }: { item: CartItem }) => (
  <button onClick={() => addToCart(item)}>Add</button>
));
```

Three components in three different places in the tree. No context provider, no Redux store, no pub/sub. Each component re-renders only when the values it reads change — `CartBadge` reacts to `length`, `CartSummary` reacts to `cartTotal()`.

{% callout title="Module-scoped signals and testing" %}
Module-scoped signals are global by default, which makes them trivial to use and a little more work to isolate in tests. For testable dependency injection, use a [Signalium context](/reactivity/contexts) and the `ContextProvider` component from `signalium/react`. See [Testing](/integrating/testing) for fixtures.
{% /callout %}

## Pattern 3: Bridge to legacy components with `useReactive`

You can't convert every component in one pass — and you shouldn't have to. When a plain React function component needs to read a signal, use `useReactive`:

```tsx
import { useReactive } from 'signalium/react';
import { cartTotal } from '@/state/cart';

function LegacyHeader() {
  const total = useReactive(() => cartTotal());
  return (
    <header className="legacy-header">
      <span>Cart total: ${total}</span>
    </header>
  );
}
```

`useReactive` is a hook, so it follows the rules of hooks, but it lets a classic function component subscribe to anything in the signal graph — a raw signal (`() => signal.value`), a reactive function (`() => loadUser(id)`), or any expression that reads from the graph.

See [useReactive & imperative reads](/integrating/use-reactive) for the full story.

## Pattern 4: Let hooks and signals coexist inside the same component

There's no reason to stop using React hooks when you adopt Signalium. `useEffect` is still the right tool for imperative side effects. `useRef` is still the right tool for non-reactive mutable slots. `useState` is still fine when you don't need fine-grained reactivity.

```tsx
import { useEffect, useRef } from 'react';
import { component, useSignal } from 'signalium/react';

const Chart = component(({ points }: { points: number[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredIndex = useSignal<number | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawChart(ctx, points, hoveredIndex.value);
  }, [points, hoveredIndex.value]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={(e) => (hoveredIndex.value = indexFromEvent(e))}
    />
  );
});
```

The signal reads inside `useEffect`'s dependency array work exactly how you'd expect. `hoveredIndex.value` changes, effect re-runs. `useEffect` is still the right answer when you need a side effect to fire on a particular render.

See [Hooks interop](/integrating/hooks) for the deeper story on mixing the two models.

## A worked example: a settings panel

Imagine a settings screen with user preferences — theme, notifications toggle, and a language picker — rendered inside an app that still uses Redux for its authoritative user state. You want to replace the settings panel with Signalium without touching Redux.

```ts
// app/state/settings.ts
import { signal, reactive } from 'signalium';

export const theme = signal<'light' | 'dark'>('light');
export const notificationsEnabled = signal(true);
export const language = signal('en');

export const settingsSummary = reactive(() => ({
  theme: theme.value,
  notifications: notificationsEnabled.value,
  language: language.value,
}));
```

```tsx
// app/components/SettingsPanel.tsx
import { component } from 'signalium/react';
import {
  theme,
  notificationsEnabled,
  language,
  settingsSummary,
} from '@/state/settings';

export const SettingsPanel = component(() => (
  <section>
    <ThemeRow />
    <NotificationsRow />
    <LanguageRow />
    <SettingsPreview />
  </section>
));

const ThemeRow = component(() => (
  <label>
    Theme:
    <select
      value={theme.value}
      onChange={(e) => (theme.value = e.target.value as 'light' | 'dark')}
    >
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
));

const NotificationsRow = component(() => (
  <label>
    <input
      type="checkbox"
      checked={notificationsEnabled.value}
      onChange={(e) => (notificationsEnabled.value = e.target.checked)}
    />
    Notifications
  </label>
));

const LanguageRow = component(() => (
  <label>
    Language:
    <select
      value={language.value}
      onChange={(e) => (language.value = e.target.value)}
    >
      <option value="en">English</option>
      <option value="es">Español</option>
      <option value="ja">日本語</option>
    </select>
  </label>
));

const SettingsPreview = component(() => {
  const summary = settingsSummary();
  return <pre>{JSON.stringify(summary, null, 2)}</pre>;
});
```

Each row only re-renders when its own signal changes. `SettingsPreview` re-renders when any of the three change. The rest of the app — Redux, react-router, your legacy layout components — doesn't notice.

When you're ready to bridge back into Redux-world, either read the Redux store from inside a `component(...)` with the usual `useSelector` (see [State libraries](/integrating/state-libraries)), or expose a slice as a signal and let Redux and Signalium share state.

## A worked example: a form with validation

Forms are where `useMemo` and `useCallback` proliferate the fastest. Here's a form with cross-field validation, written with Signalium:

```ts
// app/state/signup-form.ts
import { signal, reactive } from 'signalium';

export const email = signal('');
export const password = signal('');
export const confirm = signal('');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailError = reactive(() => {
  if (!email.value) return null;
  return emailRegex.test(email.value) ? null : 'Invalid email';
});

export const passwordError = reactive(() => {
  if (!password.value) return null;
  return password.value.length >= 8 ? null : 'Must be at least 8 characters';
});

export const confirmError = reactive(() => {
  if (!confirm.value) return null;
  return confirm.value === password.value ? null : 'Passwords do not match';
});

export const isValid = reactive(
  () =>
    email.value !== '' &&
    password.value !== '' &&
    confirm.value !== '' &&
    !emailError() &&
    !passwordError() &&
    !confirmError(),
);
```

```tsx
// app/components/SignupForm.tsx
import { component } from 'signalium/react';
import {
  email,
  password,
  confirm,
  emailError,
  passwordError,
  confirmError,
  isValid,
} from '@/state/signup-form';

export const SignupForm = component(() => (
  <form onSubmit={handleSubmit}>
    <Field signal={email} label="Email" error={emailError} type="email" />
    <Field
      signal={password}
      label="Password"
      error={passwordError}
      type="password"
    />
    <Field
      signal={confirm}
      label="Confirm"
      error={confirmError}
      type="password"
    />
    <SubmitButton />
  </form>
));

const Field = component(
  ({
    signal,
    label,
    error,
    type,
  }: {
    signal: ReturnType<typeof useSignal<string>>;
    label: string;
    error: () => string | null;
    type: string;
  }) => (
    <label>
      {label}
      <input
        type={type}
        value={signal.value}
        onChange={(e) => (signal.value = e.target.value)}
      />
      {error() && <span className="error">{error()}</span>}
    </label>
  ),
);

const SubmitButton = component(() => (
  <button type="submit" disabled={!isValid()}>
    Sign up
  </button>
));
```

Each `<Field>` re-renders only when its own signal or its own error changes. `<SubmitButton>` re-renders only when `isValid()` flips. No dependency arrays, no `useCallback`, no `React.memo`.

## What not to do

### Don't wrap your entire app in one giant `component(...)`

It will work, but you lose most of the win. The fine-grained subscription model assumes many small `component(...)`s, each tracking exactly the signals they read. One huge component that reads every signal in the app behaves like a big `React.memo(false)` — it re-renders on every change.

### Don't rewrite your data layer on day one

Keep your existing fetch/React Query/Redux plumbing. Introduce signals for the state that's most painful to manage with hooks, then gradually migrate more — or don't. Signalium is happy to live alongside Redux, Zustand, TanStack Query, or plain `fetch`. See [State libraries](/integrating/state-libraries).

### Don't mix `useState` and `useSignal` for the same value

Pick one. If a value needs to drive reactive derivations, make it a signal. If it's purely local UI bookkeeping, `useState` is fine. Trying to keep both in sync manually is a trap.

## A realistic migration timeline

For a medium-sized React codebase, a typical incremental path looks like:

1. **Week one.** Install Signalium. Pick one pain-point component. Convert it. Ship it.
2. **Week two.** Lift shared state into a few module-scoped signals or contexts. Convert the components that consume them.
3. **Month two.** Introduce `reactive(async ...)` for a few data-fetching endpoints. Enable the Babel preset if you want async components.
4. **Month three onwards.** New features are Signalium by default. Legacy components stay as-is, bridged by `useReactive` where needed.

At no point do you need to stop shipping features to migrate. Mixed is a stable end state; most large Signalium codebases never finish "converting" and never need to.

## Next steps

- [Hooks interop](/integrating/hooks) — how `useState`, `useRef`, `useEffect`, and custom hooks coexist with `component(...)`.
- [useReactive & imperative reads](/integrating/use-reactive) — the escape hatch for reading signals from plain function components.
- [State libraries](/integrating/state-libraries) — Redux, Zustand, and TanStack Query interop.
- [Layering on React](/components/layering) — the conceptual story of how Signalium coexists with everything React ships.
