import { component } from 'signalium/react';
import { reactive, callback as _callback } from 'signalium';
const fetchData = reactive(function* (id: string) {
  const res = yield fetch(`/api/${id}`);
  return res.json();
});
const MyComponent = component(function* (props: {
  id: string;
}) {
  const data = yield fetchData(props.id);
  return data;
});
