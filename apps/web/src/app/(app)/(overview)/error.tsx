'use client';

// The dashboard's error state (studio standard 02): what happened, what to do, a retry,
// and the lists still work. Never a raw error.
import Link from 'next/link';

export default function OverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="state-error" role="alert">
      <h1>The overview couldn’t load its figures</h1>
      <p>
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
        <Link className="button" href="/issues">
          Issues
        </Link>
        <Link className="button" href="/jobs">
          Jobs
        </Link>
      </div>
    </div>
  );
}
