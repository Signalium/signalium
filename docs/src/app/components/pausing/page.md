---
title: Pausing signal subtrees
---

`PauseSignalsProvider` temporarily unwatches every signal and relay inside a React subtree without unmounting it. Components keep their DOM, React state, and last-known signal values — but stop reacting to updates until you un-pause.

This is built for cases where a subtree is *inactive but still mounted*: React Native screens behind a tab, hidden modal content, or an expensive data view that shouldn't re-render while off-screen.

```tsx
import { PauseSignalsProvider } from 'signalium/react';

function TabNavigator() {
  const [activeTab, setActiveTab] = useState('home');

  return (
    <>
      <PauseSignalsProvider value={activeTab !== 'home'}>
        <HomeScreen />
      </PauseSignalsProvider>

      <PauseSignalsProvider value={activeTab !== 'profile'}>
        <ProfileScreen />
      </PauseSignalsProvider>
    </>
  );
}
```

## What happens when you pause

`value={true}` triggers:

1. **Unwatch.** Every signal the subtree was reading is detached from the reactive graph as far as this subtree is concerned.
2. **Relay teardown.** Any [relay](/reactivity/relays) activated inside the subtree calls its cleanup. WebSockets close, intervals are cleared, subscriptions cancel.
3. **Preserved values.** Components keep displaying whatever they last read. No re-render, no flashes.
4. **No child re-render.** The pause provider uses a stable context value, so toggling `value` doesn't cause descendants to re-render — they simply stop reacting.

When `value={false}`:

1. **Re-watch.** Signals are re-attached. The subtree immediately sees current values.
2. **Relay re-bootstrap.** Relays activate again — WebSockets reconnect, intervals restart, subscriptions resume.
3. **Updates resume.** Mutations start triggering re-renders again.

## React Native tabs

The canonical use case. React Native keeps tab screens mounted, which is great for instant switching but bad for background resource use.

```tsx
import { useIsFocused } from '@react-navigation/native';
import { component, PauseSignalsProvider } from 'signalium/react';

const TabScreen = component(({ children }) => {
  const isFocused = useIsFocused();

  return (
    <PauseSignalsProvider value={!isFocused}>
      {children}
    </PauseSignalsProvider>
  );
});
```

Drop `TabScreen` at the root of each tab and every relay (live queries, subscriptions, timers) inside that tab will quiet down when the user switches away.

## Hidden views

Same idea, but for CSS-hidden content:

```tsx
<PauseSignalsProvider value={!isOpen}>
  <div style={{ display: isOpen ? 'block' : 'none' }}>
    <ExpensiveReport />
  </div>
</PauseSignalsProvider>
```

## Caveats

- **Pausing is not unmounting.** Components still occupy memory and DOM. If a subtree is truly done, unmount it.
- **Manual reads can still run.** If something else causes the component tree to re-render (prop change, React state), a paused component's render function still executes. It will compute with whatever values it last saw — no relay inside the paused subtree wakes up just to answer — but if you have expensive synchronous work in render, pausing alone won't save it.
- **Relays re-bootstrap on unpause.** If your relay is expensive to start, account for that latency on un-pause.

{% callout type="warning" title="Nested pause providers" %}
Nesting `PauseSignalsProvider`s works, but the innermost active-state wins for any given subtree. If the outer provider is paused, inner `value={false}` can't "un-pause" — the subtree stays paused.
{% /callout %}

## Next steps

- [Relays](/reactivity/relays) — understand activation/deactivation so you can design relays that recover cleanly from pauses.
- [React Native](/integrating/react-native) — full React Native patterns including navigation and persistence.
