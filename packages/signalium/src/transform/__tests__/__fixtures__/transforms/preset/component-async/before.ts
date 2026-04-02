import { component } from 'signalium/react';
import { reactive } from 'signalium';

const fetchData = reactive(async (id: string) => {
  const res = await fetch(`/api/${id}`);
  return res.json();
});

const MyComponent = component(async (props: { id: string }) => {
  const data = await fetchData(props.id);
  return data;
});
