export type GroupNavigationItem = {
  type: 'group';
  title: string;
  items: NavigationItem[];
};

export type LinkNavigationItem = {
  type: 'link';
  title: string;
  href: string;
};

export type NavigationItem = GroupNavigationItem | LinkNavigationItem;

const findLinkItem = (
  items: NavigationItem[],
  pathname: string,
): LinkNavigationItem | undefined => {
  for (const item of items) {
    if (item.type === 'group') {
      const result = findLinkItem(item.items, pathname);
      if (result) return result;
    } else if (item.href === pathname) {
      return item;
    }
  }
};

export const findNavigationItem = (
  pathname: string,
): LinkNavigationItem | undefined => {
  return findLinkItem(navigation, pathname);
};

const findGroupItem = (
  items: NavigationItem[],
  pathname: string,
): GroupNavigationItem | undefined => {
  for (const item of items) {
    if (item.type !== 'group') {
      continue;
    }

    if (
      item.items.some((item) => item.type === 'link' && item.href === pathname)
    ) {
      return item;
    }
  }
};

export const findNavigationParentGroup = (
  pathname: string,
): GroupNavigationItem | undefined => {
  return findGroupItem(navigation, pathname);
};

const flattenItem = (item: NavigationItem[]): LinkNavigationItem[] => {
  return item.flatMap((item) => {
    if (item.type === 'group') {
      return flattenItem(item.items);
    }
    return item;
  });
};

export const flattenNavigation = (
  navigation: NavigationItem[],
): LinkNavigationItem[] => {
  return flattenItem(navigation);
};

export const navigation: GroupNavigationItem[] = [
  {
    title: 'Getting started',
    type: 'group',
    items: [
      { type: 'link', title: 'Quick start', href: '/quickstart' },
      { type: 'link', title: 'Installation & setup', href: '/setup/install' },
      { type: 'link', title: 'Why Signalium?', href: '/setup/why' },
    ],
  },
  {
    title: 'Components',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Your first component',
        href: '/components/first-component',
      },
      {
        type: 'link',
        title: 'Local state with useSignal',
        href: '/components/use-signal',
      },
      {
        type: 'link',
        title: 'Derived values with reactive',
        href: '/components/reactive-values',
      },
      {
        type: 'link',
        title: 'Async components & Suspense',
        href: '/components/async',
      },
      {
        type: 'link',
        title: 'Providing context',
        href: '/components/contexts',
      },
      {
        type: 'link',
        title: 'Pausing signal subtrees',
        href: '/components/pausing',
      },
      {
        type: 'link',
        title: 'Layering on React',
        href: '/components/layering',
      },
    ],
  },
  {
    title: 'The reactivity system',
    type: 'group',
    items: [
      { type: 'link', title: 'Signals', href: '/reactivity/signals' },
      {
        type: 'link',
        title: 'Reactive functions',
        href: '/reactivity/reactive-functions',
      },
      {
        type: 'link',
        title: 'Reactive promises',
        href: '/reactivity/reactive-promises',
      },
      { type: 'link', title: 'Relays', href: '/reactivity/relays' },
      { type: 'link', title: 'Watchers', href: '/reactivity/watchers' },
      { type: 'link', title: 'Contexts', href: '/reactivity/contexts' },
      {
        type: 'link',
        title: 'Scheduling & batching',
        href: '/reactivity/scheduling',
      },
    ],
  },
  {
    title: 'Integrating Signalium',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Incremental adoption',
        href: '/integrating/existing-apps',
      },
      {
        type: 'link',
        title: 'Hooks interop',
        href: '/integrating/hooks',
      },
      {
        type: 'link',
        title: 'useReactive & imperative reads',
        href: '/integrating/use-reactive',
      },
      {
        type: 'link',
        title: 'RSC & SSR',
        href: '/integrating/rsc-ssr',
      },
      {
        type: 'link',
        title: 'React Native',
        href: '/integrating/react-native',
      },
      {
        type: 'link',
        title: 'State libraries',
        href: '/integrating/state-libraries',
      },
      { type: 'link', title: 'Testing', href: '/integrating/testing' },
      {
        type: 'link',
        title: 'Bundler setup',
        href: '/integrating/bundlers',
      },
    ],
  },
  {
    title: 'Guides & deep dives',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Advanced reactive behaviors',
        href: '/guides/reactive-function-behaviors',
      },
      {
        type: 'link',
        title: 'Signals as monads',
        href: '/guides/signals-as-monads',
      },
      {
        type: 'link',
        title: 'Code transforms & async context',
        href: '/guides/code-transforms',
      },
    ],
  },
  {
    title: 'API reference',
    type: 'group',
    items: [
      { type: 'link', title: 'signalium', href: '/api/signalium' },
      { type: 'link', title: 'signalium/react', href: '/api/signalium/react' },
      { type: 'link', title: 'signalium/utils', href: '/api/signalium/utils' },
      {
        type: 'link',
        title: 'signalium/config',
        href: '/api/signalium/config',
      },
      {
        type: 'link',
        title: 'signalium/transform',
        href: '/api/signalium/transform',
      },
    ],
  },
];
