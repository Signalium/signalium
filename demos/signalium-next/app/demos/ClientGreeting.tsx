'use client';

import { Suspense } from 'react';
import { component } from 'signalium/react';
import { loadGreeting } from './shared-reactives';
import { GreetingCard } from './GreetingCard';

const ClientGreetingInner = component(async (props: { name: string }) => {
  const text = await loadGreeting(props.name);
  return <GreetingCard headline={text} source="client" />;
});

export function ClientGreeting({ name }: { name: string }) {
  return (
    <Suspense fallback={<p style={{ opacity: 0.65 }}>Loading client…</p>}>
      <ClientGreetingInner name={name} />
    </Suspense>
  );
}
