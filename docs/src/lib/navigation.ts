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
        title: 'React Integration',
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
      {
        type: 'link',
        title: 'Code Transforms and Async Context',
        href: '/advanced/code-transforms-and-async-context',
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
