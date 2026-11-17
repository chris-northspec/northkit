// The dashboard's loading state (studio standard 02): a skeleton shaped like the
// health panel and the cards, hidden from assistive tech; a status says what's loading.
export default function Loading() {
  return (
    <div aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading the overview…
      </p>
      <span className="skeleton skeleton-title" aria-hidden="true" />
      <div className="panel health" aria-hidden="true">
        <span className="skeleton skeleton-ring" />
        <div className="health-text">
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      </div>
      <div className="dash-cards" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="skeleton skeleton-card" />
        ))}
      </div>
    </div>
  );
}
