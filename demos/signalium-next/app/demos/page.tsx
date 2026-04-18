import Link from 'next/link';
import { Suspense, type CSSProperties } from 'react';
import { ClientGreeting } from './ClientGreeting';
import { ClientNested } from './ClientNested';
import { DEMO_NAME } from './shared-reactives';
import { ServerGreeting } from './ServerGreeting';
import { ServerNestedOuter } from './ServerNested';

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '1rem',
  alignItems: 'start',
};

const sectionTitle: CSSProperties = {
  margin: '0 0 0.75rem',
  fontSize: '1.05rem',
};

export default function DemosPage() {
  return (
    <main style={{ maxWidth: 920 }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/">← Home</Link>
      </p>
      <h1 style={{ marginTop: '0.25rem' }}>Demos</h1>
      <p style={{ maxWidth: '62ch', lineHeight: 1.5 }}>
        Shared <code>reactive(async …)</code> loaders live in <code>app/demos/shared-reactives.ts</code>. Both server
        and client use <code>component(async …)</code> &mdash; the same definitions work in either environment.
      </p>

      <section style={{ marginTop: '2.25rem' }}>
        <h2 style={sectionTitle}>Greeting</h2>
        <div style={grid}>
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#444' }}>Server</p>
            <Suspense fallback={<p style={{ opacity: 0.65 }}>Loading server…</p>}>
              <ServerGreeting name={DEMO_NAME} />
            </Suspense>
          </div>
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#444' }}>Client</p>
            <ClientGreeting name={DEMO_NAME} />
          </div>
        </div>
      </section>

      <section style={{ marginTop: '2.25rem' }}>
        <h2 style={sectionTitle}>Nested async (outer → inner)</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', maxWidth: '62ch' }}>
          Identical <code>component(async …)</code> definitions on both sides. The server&rsquo;s{' '}
          <code>component()</code> (via the <code>react-server</code> export condition) returns a real{' '}
          <code>async function</code> that RSC awaits; the client&rsquo;s returns a hooks-based Suspense wrapper.
        </p>
        <div style={grid}>
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#444' }}>Server</p>
            <Suspense fallback={<p style={{ opacity: 0.65 }}>Loading nested (server)…</p>}>
              <ServerNestedOuter />
            </Suspense>
          </div>
          <div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#444' }}>Client</p>
            <ClientNested />
          </div>
        </div>
      </section>
    </main>
  );
}
