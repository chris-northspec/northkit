import { Illustration } from '@/components/illustration';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <Illustration name="error" className="empty-picture" width={240} height={160} />
        <h1>Page not found</h1>
        <p>That address doesn’t match a page. It may have moved, or the link may be wrong.</p>
        <Link href="/" className="button button-primary">
          Go to home
        </Link>
      </div>
    </main>
  );
}
