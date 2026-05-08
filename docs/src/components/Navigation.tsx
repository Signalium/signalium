'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

import {
  GroupNavigationItem,
  LinkNavigationItem,
  navigation,
  NavigationItem,
} from '@/lib/navigation';

function NavigationListItem({
  item,
  isRoot = false,
  onLinkClick,
}: {
  item: NavigationItem;
  onLinkClick?: React.MouseEventHandler<HTMLAnchorElement>;
  isRoot?: boolean;
}) {
  return item.type === 'group' ? (
    <GroupNavigationListItem
      item={item}
      isRoot={isRoot}
      onLinkClick={onLinkClick}
    />
  ) : (
    <LinkNavigationListItem item={item} onLinkClick={onLinkClick} />
  );
}

function GroupNavigationListItem({
  item,
  isRoot = false,
  onLinkClick,
}: {
  item: GroupNavigationItem;
  isRoot?: boolean;
  onLinkClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <li key={item.title}>
      <h2 className="px-6 font-display text-[11px] font-semibold tracking-wider text-primary-500 uppercase">
        {item.title}
      </h2>
      <ul role="list" className="mt-3 space-y-0.5">
        {item.items.map((item) => (
          <NavigationListItem
            key={item.title}
            item={item}
            onLinkClick={onLinkClick}
          />
        ))}
      </ul>
    </li>
  );
}

function LinkNavigationListItem({
  item,
  onLinkClick,
}: {
  item: LinkNavigationItem;
  onLinkClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  let pathname = usePathname();
  let isActive = item.href === pathname;

  return (
    <li key={item.title}>
      <Link
        href={item.href}
        onClick={onLinkClick}
        className={clsx(
          'block border-r-2 py-2 pr-4 pl-6 text-sm transition-colors',
          isActive
            ? 'border-tertiary-300 bg-tertiary-300/10 font-medium text-tertiary-300'
            : 'border-transparent text-primary-300/70 hover:text-white',
        )}
      >
        {item.title}
      </Link>
    </li>
  );
}

export function Navigation({
  className,
  onLinkClick,
}: {
  className?: string;
  onLinkClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <nav className={clsx('text-sm', className)}>
      <ul role="list" className="space-y-6">
        {navigation.map((item) => (
          <NavigationListItem
            key={item.title}
            item={item}
            onLinkClick={onLinkClick}
            isRoot={true}
          />
        ))}
      </ul>
    </nav>
  );
}
