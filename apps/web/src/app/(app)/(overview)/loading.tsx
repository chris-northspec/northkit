// The overview's loading state (standard 13): skeletons shaped like the four stat cards and
// the table beside the needs-action panel, with a gentle shimmer. Never a full-page spinner.
export default function Loading() {
  return (
    <div aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading the overview…
      </p>
      <span className="skeleton skeleton-title" aria-hidden="true" />
      <div className="stats" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="skeleton skeleton-card" />
        ))}
      </div>
      <div className="split" aria-hidden="true">
        <div>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className="skeleton skeleton-row" />
          ))}
        </div>
        <span className="skeleton skeleton-card" />
      </div>
    </div>
  );
}
