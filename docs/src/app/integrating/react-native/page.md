---
title: React Native
---

Signalium runs in React Native without any special runtime setup. Everything you've read in the core docs applies: you import from `signalium` and `signalium/react`, you use `component(...)` and `useSignal`, and you render reactive views. The React Native quirks are all about the bundler (Metro) and the platform's specific lifecycle (tab navigation, background screens, app state). This page covers both.

## Install

```bash
npm install signalium
# or
yarn add signalium
```

No native modules, no Gradle/Podfile changes, no linking step. It's a pure-JS library.

## Metro + Babel preset

Metro uses `babel-preset-expo` or `metro-react-native-babel-preset`. To enable async `component(async () => ...)` and `reactive(async () => ...)`, add the Signalium preset to your `babel.config.js`:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo', // or 'module:metro-react-native-babel-preset'
      signaliumPreset(),
    ],
  };
};
```

The preset order matters — Signalium's preset should come **after** the React Native preset so the RN preset's transforms run first on the original source.

{% callout title="Clearing the Metro cache" %}
After adding or updating Babel plugins, clear Metro's cache so the new transforms take effect:

```bash
npx expo start --clear
# or
npx react-native start --reset-cache
```
{% /callout %}

If you're not using async components or reactive async functions, you don't need the preset. Synchronous `component(...)`, `signal`, and `reactive(...)` work with the default RN Babel config.

See [Bundler setup](/integrating/bundlers) for the full Babel preset options.

## A first component

Nothing about the React API changes on RN:

```tsx
import React from 'react';
import { View, Text, Button } from 'react-native';
import { component, useSignal } from 'signalium/react';

export const Counter = component(() => {
  const count = useSignal(0);

  return (
    <View>
      <Text>Count: {count.value}</Text>
      <Button title="Increment" onPress={() => count.value++} />
    </View>
  );
});
```

`Text` and `View` are RN's built-in components; `component(...)` wraps a regular function the same way it does on the web.

## Tab navigation and `PauseSignalsProvider`

React Navigation's tab and stack navigators keep screens mounted in the background by default. That's good for perceived performance — switching back to a tab is instant — but it means all your signals keep reacting, relays keep pushing updates, and effects keep running even when the screen is offscreen.

`PauseSignalsProvider` gives you a way to pause signal updates for an offscreen subtree without unmounting it:

```tsx
import { useIsFocused } from '@react-navigation/native';
import { PauseSignalsProvider } from 'signalium/react';
import { HomeScreen } from './screens/home';

export function HomeTab() {
  const isFocused = useIsFocused();
  return (
    <PauseSignalsProvider value={!isFocused}>
      <HomeScreen />
    </PauseSignalsProvider>
  );
}
```

`value={true}` means "paused." When `isFocused` flips to `false`, the subtree is unwatched: relays tear down, signal updates stop propagating, and components don't re-render. When the user comes back, `isFocused` flips to `true`, the subtree re-watches, and components sync to current signal values on the next render.

{% callout title="How pausing behaves" %}
Pausing *unwatches* signals — it doesn't dispose them. Values are preserved, and when the subtree resumes, it picks up with the latest values. Relays re-bootstrap on resume, so any external subscription (WebSocket, interval, etc.) will reconnect. See [Pausing signal subtrees](/components/pausing) for the full reference.
{% /callout %}

### A pattern for every tab

In a bottom-tab layout, wrap each screen at the top level:

```tsx
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { PauseSignalsProvider } from 'signalium/react';

const Tab = createBottomTabNavigator();

function withPausedSignals<P>(Screen: React.ComponentType<P>) {
  return function PausedScreen(props: P) {
    const isFocused = useIsFocused();
    return (
      <PauseSignalsProvider value={!isFocused}>
        <Screen {...props} />
      </PauseSignalsProvider>
    );
  };
}

export function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator>
        <Tab.Screen name="Home" component={withPausedSignals(HomeScreen)} />
        <Tab.Screen name="Feed" component={withPausedSignals(FeedScreen)} />
        <Tab.Screen name="Profile" component={withPausedSignals(ProfileScreen)} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

Each tab pauses its signal subtree when the user navigates away and resumes it when they come back.

### Stack navigation

React Navigation's stack navigators also keep previous screens mounted. The pattern is identical — wrap each screen's render in a `PauseSignalsProvider` driven by `useIsFocused`:

```tsx
function Screen({ children }: { children: React.ReactNode }) {
  const isFocused = useIsFocused();
  return (
    <PauseSignalsProvider value={!isFocused}>
      {children}
    </PauseSignalsProvider>
  );
}
```

If multiple nested navigators stack up, the outermost unfocused provider wins — signals won't resume until every wrapping `PauseSignalsProvider` has `value={false}`.

## App state: foreground, background, inactive

You often want to pause *everything* when the app goes to the background, not just a specific tab. Combine RN's `AppState` with a top-level `PauseSignalsProvider`:

```tsx
import { AppState, AppStateStatus } from 'react-native';
import { useEffect } from 'react';
import { PauseSignalsProvider, component, useSignal } from 'signalium/react';

export const AppLifecycle = component(({ children }: { children: React.ReactNode }) => {
  const appState = useSignal<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      appState.value = next;
    });
    return () => sub.remove();
  }, []);

  return (
    <PauseSignalsProvider value={appState.value !== 'active'}>
      {children}
    </PauseSignalsProvider>
  );
});
```

When the app backgrounds, all signals under `AppLifecycle` are paused. When it foregrounds, everything resumes and components sync to current values.

You can nest this with per-tab pausing — the "is paused?" decision is `tabInactive || appBackgrounded`.

## Relays for persistent connections

Relays are the right primitive for long-lived external connections — WebSockets, EventSource, interval-based polling, native module listeners. A relay sets up its subscription on the first subscribe and tears it down when no one is listening. On RN, that pairs naturally with `PauseSignalsProvider`:

```ts
// app/realtime.ts
import { relay } from 'signalium';

export const chatStream = relay<Message[]>((state) => {
  state.value = [];

  const ws = new WebSocket('wss://example.com/chat');
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    state.value = [...state.value, msg];
  };

  return () => ws.close();
});
```

```tsx
// app/screens/chat.tsx
import { component } from 'signalium/react';
import { chatStream } from '@/realtime';

export const ChatScreen = component(() => {
  const messages = chatStream();

  return (
    <FlatList
      data={messages.value}
      keyExtractor={(m) => m.id}
      renderItem={({ item }) => <MessageRow message={item} />}
    />
  );
});
```

Because the chat screen is inside a `PauseSignalsProvider`, when the user navigates away or the app goes to the background, the relay's subscribe count drops to zero and the WebSocket is torn down. When they come back, the relay reconnects. No `AppState` listeners, no manual reconnection logic — the relay's lifecycle is driven by its consumers.

See [Relays](/reactivity/relays) for the full reference.

## Background behavior and batching

React Native uses the same `requestAnimationFrame`-style scheduling for its JS timers as the browser, and Signalium's scheduler works the same way on both. Notes:

- When the app is backgrounded, RN typically throttles or pauses JS timers on iOS. Signals updated from a relay that *is* still pushing updates (a native module, a socket with its own thread) will still queue — when the JS thread wakes, they'll all flush together. If that's a problem, pause the subtree.
- For expensive or frequent updates that should only fire when visible, prefer a relay driven by the screen's mount lifecycle over a module-scoped `setInterval`. Pausing signals then effectively also pauses the relay.
- `useEffect`'s cleanup functions run on unmount as normal. If you ever need tighter control than "pause when offscreen," fall back to `useEffect` + `AppState` + explicit teardown.

## Interop with `useFocusEffect`

React Navigation ships `useFocusEffect` for effects that should run only while the screen is focused. That remains the right tool for *imperative* focus logic — analytics pings, haptics, imperative native calls. For *reactive* subscriptions, `PauseSignalsProvider` is cleaner because it pauses the entire reactive graph under the subtree instead of requiring manual teardown.

```tsx
import { useFocusEffect } from '@react-navigation/native';

export const Screen = component(() => {
  useFocusEffect(
    React.useCallback(() => {
      analytics.track('screen_view');
      return () => analytics.track('screen_leave');
    }, []),
  );
  // …signals, relays, and reactive functions are all still live here,
  // unless wrapped in a PauseSignalsProvider higher up
});
```

Use both: `useFocusEffect` for one-shot imperative work, `PauseSignalsProvider` for the reactive-subtree lifecycle.

## Lists and `FlatList`

`FlatList` expects stable item references for `keyExtractor` and `renderItem`. Reactive snapshots from `useReactive` preserve referential equality on unchanged items — if only one row updates, only that row's data object is a new reference:

```tsx
const messages = useReactive(() => chatStream().value);

<FlatList data={messages} keyExtractor={(m) => m.id} renderItem={...} />;
```

This plays nicely with `FlatList`'s internal memoization. If you build your row with `component(...)`, prop comparison is already semi-deep; if you use `React.memo`, the stable references mean memoization works as expected.

## Hermes

Signalium runs on Hermes out of the box. No special flags. If you're using Hermes's strict-mode checks (especially in newer RN versions), Signalium's signals, reactive functions, and relays all behave correctly under them.

## Expo

On Expo, the Babel preset plugs into `babel-preset-expo`:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'react' }],
      signaliumPreset(),
    ],
  };
};
```

Reload with `npx expo start --clear` after updating.

## Tips

- **Put signals at module scope.** Shared state (auth tokens, current user, feature flags) is cleanest as a module-scoped signal. No provider tree needed; any screen can read it.
- **Use relays for anything with a subscription lifecycle.** Sockets, geolocation watchers, native event emitters. Relays tear down automatically when no one's listening.
- **Wrap tabs in `PauseSignalsProvider`.** It's the single biggest win for battery life and perceived responsiveness in a tab-based app.
- **Don't `await` inside native-module callbacks unless you know what you're doing.** Use a relay to bridge native event streams into the reactive graph.

## Next steps

- [Pausing signal subtrees](/components/pausing) — the full reference for `PauseSignalsProvider`.
- [Relays](/reactivity/relays) — long-lived subscriptions with automatic teardown.
- [Bundler setup](/integrating/bundlers) — Metro and other bundler configurations.
- [Incremental adoption](/integrating/existing-apps) — if you're bringing Signalium into an existing RN app.
