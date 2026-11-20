'use client';

// The overview's error state: what happened, what to do, a retry, and the lists still work.
// Never a raw error.
import Link from 'next/link';
import { Illustration } from '@/components/illustration';

export default function OverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="empty" role="alert">
      <Illustration name="error" className="empty-picture" width={240} height={160} />
      <h1>The overview couldn’t load its figures</h1>
      <p className="muted">
        Something went wrong while counting. Try again; the lists still work in the meantime. If it
        keeps happening, tell your administrator.
      </p>
      {error.digest ? (
        <p className="muted small">
          Reference: <span className="mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="form-actions">
        <button type="button" className="button button-primary" onClick={reset}>
          Try again
        </button>
        <Link className="button" href="/items">
          Items
        </Link>
        <Link className="button" href="/who-has-what">
          Who has what
        </Link>
      </div>
    </div>
  );
}
