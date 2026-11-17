'use client';

// Error state inside the shell (studio standard 02): a plain message, what to do, a retry.
// Never a raw error: the digest is a reference the administrator can find in the logs.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="state-error" role="alert">
      <h1>This page couldn’t load</h1>
      <p>
        Something went wrong on the server. Try again; if it keeps happening, tell your
        administrator.
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
      </div>
    </div>
  );
}
