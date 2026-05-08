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
        <div className="flex items-center gap-2 text-sm text-primary-400">
          <span>{section.title}</span>
          {title && (
            <>
              <span className="text-primary-600">/</span>
              <span className="text-secondary-300">{title}</span>
            </>
          )}
        </div>
      )}
      {title && (
        <h1 className="font-display text-3xl tracking-tight text-white">
          {title}
        </h1>
      )}
    </header>
  );
}
