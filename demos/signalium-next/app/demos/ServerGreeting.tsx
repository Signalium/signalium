import { component } from 'signalium/react';
import { loadGreeting } from './shared-reactives';
import { GreetingCard } from './GreetingCard';

const ServerGreetingInner = component(async (props: { name: string }) => {
  const text = await loadGreeting(props.name);
  return <GreetingCard headline={text} source="server" />;
});

export function ServerGreeting({ name }: { name: string }) {
  return <ServerGreetingInner name={name} />;
}
