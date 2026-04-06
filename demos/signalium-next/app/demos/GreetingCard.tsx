export function GreetingCard({
  headline,
  subline,
  source,
}: {
  headline: string;
  subline?: string;
  source: 'server' | 'client';
}) {
  return (
    <article
      style={{
        border: '1px solid #c8c8c8',
        padding: '0.75rem 1rem',
        borderRadius: 8,
        background: '#fafafa',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.7rem', letterSpacing: '0.06em', color: '#555' }}>
        {source === 'server' ? 'Server (RSC)' : 'Client (Signalium)'}
      </p>
      <p style={{ margin: '0.45rem 0 0', fontWeight: 600 }}>{headline}</p>
      {subline ? <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: '#333' }}>{subline}</p> : null}
    </article>
  );
}
