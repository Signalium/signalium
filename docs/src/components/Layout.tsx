'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Logo } from '@/components/Logo';
import { MobileNavigation } from '@/components/MobileNavigation';
import { Navigation } from '@/components/Navigation';
import { Search } from '@/components/Search';
import { ModeToggle } from '@/components/CodeSwitcher';

function GitHubIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" />
    </svg>
  );
}

function Header({ showMobileNav = true }: { showMobileNav?: boolean }) {
  return (
    <header className="sticky top-0 z-50 flex h-14 flex-none items-center justify-between border-b border-primary-800 bg-primary-1000 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        {showMobileNav && (
          <div className="mr-4 flex lg:hidden">
            <MobileNavigation />
          </div>
        )}
        <Link href="/" aria-label="Home page">
          <Logo />
        </Link>
        <span className="hidden rounded bg-primary-800/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-400 ring-1 ring-primary-700 ring-inset sm:block">
          v2.4.0
        </span>
      </div>

      <div className="flex flex-1 justify-center px-4">
        <Search />
      </div>

      <nav className="flex items-center gap-5 text-sm">
        <Link
          href="/quickstart"
          className="hidden text-primary-300 transition-colors hover:text-white sm:block"
        >
          Docs
        </Link>
        <Link
          href="/components/first-component"
          className="hidden text-primary-300 transition-colors hover:text-white sm:block"
        >
          Components
        </Link>
        <Link
          href="/api/signalium"
          className="hidden text-primary-300 transition-colors hover:text-white sm:block"
        >
          API
        </Link>
        <Link
          href="https://github.com/Signalium/signalium"
          className="text-primary-300 transition-colors hover:text-white"
        >
          GitHub
        </Link>
      </nav>
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  let pathname = usePathname();
  let isHomePage = pathname === '/';

  if (isHomePage) {
    // Home page reuses the docs Header but skips the sidebar — landing pages
    // don't need the docs nav.
    return (
      <div className="flex w-full flex-col">
        <Header showMobileNav={false} />
        {children}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col">
      <Header />

      <div className="flex w-full flex-auto">
        {/* Sidebar — flush to the left edge */}
        <div className="hidden lg:block lg:flex-none">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] w-64 overflow-y-auto border-r border-primary-800 bg-primary-1000 pb-6 xl:w-72">
            <ModeToggle className="mb-6" />
            <Navigation />
          </div>
        </div>

        {/* Main content area — centered with max-width */}
        <div className="flex min-w-0 flex-1 justify-center">
          <div className="flex w-full max-w-5xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
