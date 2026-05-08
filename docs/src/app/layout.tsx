import { type Metadata } from 'next';
import {
  Inter,
  DM_Mono,
  JetBrains_Mono,
  Instrument_Sans,
} from 'next/font/google';
import clsx from 'clsx';

import { Providers } from '@/app/providers';
import { Layout } from '@/components/Layout';

import '@/styles/tailwind.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-mono',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

export const metadata: Metadata = {
  title: {
    template: '%s - Signalium Docs',
    default: 'Signalium - Fine-grained reactivity for React',
  },
  description:
    'Signals, reactive functions, and async data — an invisible layer under the React you already write.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={clsx(
        'h-full antialiased',
        inter.variable,
        dmMono.variable,
        jetbrainsMono.variable,
        instrumentSans.variable,
      )}
      suppressHydrationWarning
    >
      <body className="flex min-h-full bg-primary-950 text-white">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  );
}
