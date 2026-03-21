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
        title: 'Queries',
        href: '/core/queries',
      },
      {
        type: 'link',
        title: 'Entities',
        href: '/core/entities',
      },
      {
        type: 'link',
        title: 'Live Data',
        href: '/core/live-data',
      },
      {
        type: 'link',
        title: 'Mutations',
        href: '/core/mutations',
      },
      {
        type: 'link',
        title: 'Offline & Persistence',
        href: '/core/offline-and-persistence',
      },
    ],
  },
  {
    title: 'Reference',
    type: 'group',
    items: [
      {
        type: 'link',
        title: 'Type DSL Deep Dive',
        href: '/reference/type-dsl',
      },
      {
        type: 'link',
        title: 'Pagination & Infinite Queries',
        href: '/reference/pagination',
      },
      {
        type: 'link',
        title: 'Streaming & Subscriptions',
        href: '/reference/streaming',
      },
      {
        type: 'link',
        title: 'Why Signalium?',
        href: '/reference/why-signalium',
      },
    ],
  },
  {
    title: 'API reference',
    type: 'group',
    items: [
      { type: 'link', title: 'fetchium', href: '/api/fetchium' },
      {
        type: 'link',
        title: 'fetchium/react',
        href: '/api/fetchium-react',
      },
      {
        type: 'link',
        title: 'fetchium/stores/sync',
        href: '/api/stores-sync',
      },
      {
        type: 'link',
        title: 'fetchium/stores/async',
        href: '/api/stores-async',
      },
    ],
  },
];
