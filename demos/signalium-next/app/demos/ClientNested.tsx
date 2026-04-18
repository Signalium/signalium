'use client';

import { Suspense } from 'react';
import { component } from 'signalium/react';
import { loadInnerLabel, loadOuterLabel } from './shared-reactives';

const NestedInner = component(async () => {
  const label = await loadInnerLabel();
  return <em data-testid="demo-cli-nested-inner">{label}</em>;
});

const NestedOuter = component(async () => {
  const label = await loadOuterLabel();
  return (
    <div data-testid="demo-cli-nested-outer">
      <span>{label}</span>
      {' → '}
      <NestedInner />
    </div>
  );
});

export function ClientNested() {
  return (
    <Suspense fallback={<p style={{ opacity: 0.65 }}>Loading nested (client)…</p>}>
      <NestedOuter />
    </Suspense>
  );
}
