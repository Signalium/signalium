/**
 * Server-side `component()` — same authoring API as the client version.
 *
 * - **Generator (Babel-transformed async):** returns an `async function` that drives the generator
 *   with real promise resolution. RSC awaits it like any other async server component.
 * - **Sync:** returns a thin wrapper that sets the current consumer for reactive scope tracking.
 *
 * Activated automatically via the `react-server` condition on the `signalium/react` export.
 */
import type { ReactNode } from 'react';
import {
  type ComponentRender,
  isGeneratorFunction,
  isAsyncFunctionWithoutTransform,
  createServerAsyncComponentWrapper,
  createServerSyncComponentWrapper,
} from './component-shared.js';

export default function component<Props extends object>(
  fn: (props: Props) => Promise<ComponentRender>,
): (props: Props) => Promise<ComponentRender>;
export default function component<Props extends object>(
  fn: (props: Props) => ComponentRender,
): (props: Props) => ComponentRender;
export default function component<Props extends object>(
  fn: ((props: Props) => ComponentRender) | ((props: Props) => Promise<ComponentRender>),
): ((props: Props) => ComponentRender) | ((props: Props) => Promise<ComponentRender>) {
  if (isAsyncFunctionWithoutTransform(fn)) {
    throw new Error(
      'signalium: `component(async (props) => { await ... })` requires the Signalium Babel preset (async transform).',
    );
  }

  if (isGeneratorFunction(fn)) {
    return createServerAsyncComponentWrapper(fn as (props: Props) => Generator<any, ComponentRender, unknown>);
  }

  return createServerSyncComponentWrapper(fn as (props: Props) => ComponentRender);
}
