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
      <h2
        className={clsx(
          'font-display font-medium text-white',
          !isRoot && 'ml-px pl-3.5',
        )}
      >
        {item.title}
      </h2>
      <ul role="list" className="mt-2 space-y-2 lg:mt-4 lg:space-y-4">
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

  return (
    <li
      key={item.title}
      className="relative my-0 ml-px border-l border-divider py-1.5"
    >
      <Link
        href={item.href}
        onClick={onLinkClick}
        className={clsx(
          'block w-full pl-3.5 transition-all before:pointer-events-none before:absolute before:top-1/2 before:left-[-0.5px] before:h-1.5 before:w-1.5 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-secondary-400 before:transition-all',
          item.href === pathname
            ? 'font-semibold text-secondary-300 before:opacity-100'
            : 'text-primary-300/70 before:opacity-0 hover:text-white hover:before:opacity-100',
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
    <nav className={clsx('text-base lg:text-sm', className)}>
      <ul role="list" className="space-y-9">
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
