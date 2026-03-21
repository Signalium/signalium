'use client';

import { usePathname } from 'next/navigation';

import { findNavigationParentGroup } from '@/lib/navigation';

export function DocsHeader({ title }: { title?: string }) {
  let pathname = usePathname();
  let section = findNavigationParentGroup(pathname);

  if (!title && !section) {
    return null;
  }

  return (
    <header className="mb-9 space-y-1">
      {section && (
        <p className="font-display text-sm font-medium text-secondary-300">
          {section.title}
        </p>
      )}
      {title && (
        <h1 className="font-display text-3xl tracking-tight text-white">
          {title}
        </h1>
      )}
    </header>
  );
}
