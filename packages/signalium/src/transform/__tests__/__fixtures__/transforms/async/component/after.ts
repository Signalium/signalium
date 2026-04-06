import { component } from 'signalium/react';

export const Page = component(function* (props: {
  id: string;
}) {
  yield Promise.resolve(props.id);
  return null;
});
