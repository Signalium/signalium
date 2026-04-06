import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { setupRscRequestScope } from 'signalium/react/server';

setupRscRequestScope();

export const metadata: Metadata = {
  title: 'Signalium Next demo',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: '1rem' }}>{children}</body>
    </html>
  );
}
