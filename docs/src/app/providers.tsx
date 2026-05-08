'use client';

import { ThemeProvider } from 'next-themes';
import { ModeProvider } from '@/components/CodeSwitcher';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" disableTransitionOnChange>
      <ModeProvider>{children}</ModeProvider>
    </ThemeProvider>
  );
}
