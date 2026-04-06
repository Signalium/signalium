import { component } from 'signalium/react';
import { loadInnerLabel, loadOuterLabel } from './shared-reactives';

const NestedInner = component(async () => {
  const label = await loadInnerLabel();
  return <em data-testid="demo-srv-nested-inner">{label}</em>;
});

const NestedOuter = component(async () => {
  const label = await loadOuterLabel();
  return (
    <div data-testid="demo-srv-nested-outer">
      <span>{label}</span>
      {' → '}
      <NestedInner />
    </div>
  );
});

export { NestedOuter as ServerNestedOuter };
