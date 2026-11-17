'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-page">
      <div className="auth-card stack">
        <h1>Something went wrong</h1>
        <p>The page couldn’t load. Try again; if it keeps happening, tell your administrator.</p>
        {error.digest ? (
          <p className="muted small">
            Reference: <span className="mono">{error.digest}</span>
          </p>
        ) : null}
        <button type="button" className="button button-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
