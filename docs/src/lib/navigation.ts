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
    title: 'Introduction',
    type: 'group',
    items: [
      { type: 'link', title: 'Getting started', href: '/#getting-started' },
    ],
  },
  {
    title: 'Core concepts',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Signals and Reactive Functions',
        href: '/core/signals-and-reactive-functions',
      },
      {
        type: 'link',
        title: 'Reactive Promises',
        href: '/core/reactive-promises',
      },
      {
        type: 'link',
        title: 'Relays and Watchers',
        href: '/core/relays-and-watchers',
      },
      {
        type: 'link',
        title: 'Contexts',
        href: '/core/contexts',
      },
      {
        type: 'link',
        title: 'Usage with React',
        href: '/core/react',
      },
    ],
  },
  {
    title: 'Guides & Articles',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Advanced Reactive Techniques & Behaviors',
        href: '/advanced/reactive-function-behaviors',
      },
      {
        type: 'link',
        title: 'Signals as Monads',
        href: '/advanced/signals-as-monads',
      },
    ],
  },
  {
    title: 'API reference',
    type: 'group',
    items: [
      {
        type: 'group',
        title: 'signalium',
        items: [
          { type: 'link', title: 'signal()', href: '/api#signal' },
          {
            type: 'link',
            title: 'reactive()',
            href: '/api#reactive',
          },
          {
            type: 'link',
            title: 'task()',
            href: '/api#task',
          },
          {
            type: 'link',
            title: 'relay()',
            href: '/api#relay',
          },
          { type: 'link', title: 'watcher()', href: '/api#watcher' },
          {
            type: 'link',
            title: 'callback()',
            href: '/api#callback',
          },
          {
            type: 'link',
            title: 'createContext()',
            href: '/api#createContext',
          },
          {
            type: 'link',
            title: 'useContext()',
            href: '/api#use-context',
          },
          {
            type: 'link',
            title: 'withContexts()',
            href: '/api#with-contexts',
          },
          {
            type: 'link',
            title: 'isAsyncSignal()',
            href: '/api#is-async-signal',
          },
          {
            type: 'link',
            title: 'isTaskSignal()',
            href: '/api#is-task-signal',
          },
          {
            type: 'link',
            title: 'isRelaySignal()',
            href: '/api#is-relay-signal',
          },
          {
            type: 'link',
            title: 'hashValue()',
            href: '/api#hash-value',
          },
          {
            type: 'link',
            title: 'registerCustomHash()',
            href: '/api#register-custom-hash',
          },
        ],
      },
      {
        type: 'group',
        title: 'signalium/react',
        items: [
          {
            type: 'link',
            title: 'useStateSignal()',
            href: '/api#use-state-signal',
          },
          {
            type: 'link',
            title: 'ContextProvider',
            href: '/api#context-provider',
          },
          {
            type: 'link',
            title: 'setupReact()',
            href: '/api#setup-react',
          },
        ],
      },
    ],
  },
];
