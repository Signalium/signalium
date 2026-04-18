import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Signalium + Next</h1>
      <ul>
        <li>
          <Link href="/demos">Demos — shared reactive async (server vs client)</Link>
        </li>
      </ul>
    </main>
  );
}
