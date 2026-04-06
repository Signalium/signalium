import { component } from 'signalium/react';

export const Page = component(async (props: { id: string }) => {
  await Promise.resolve(props.id);
  return null;
});
