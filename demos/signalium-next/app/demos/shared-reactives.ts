import { reactive } from 'signalium';

// Module-level reactives: on the server, scope is per-request after setupRscRequestScope() in
// app/layout.tsx (React cache). Without that, Node shares one global SignalScope.

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Same display name for server and client panels */
export const DEMO_NAME = 'Ada';

export const loadGreeting = reactive(async (name: string) => {
  await delay(5000);
  return `Hello, ${name}!`;
});

export const loadOuterLabel = reactive(async () => {
  await delay(5000);
  return 'outer';
});

export const loadInnerLabel = reactive(async () => {
  await delay(5000);
  return 'inner';
});
