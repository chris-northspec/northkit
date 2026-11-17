import Link from 'next/link';
import type { ReactNode } from 'react';

// The four screen states (studio standard 02): loading, empty, error and populated.
// Loading is a skeleton shaped like the content; empty says why and what to do;
// error says what happened and offers a retry. Populated is the page itself.

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string } | null;
}) {
  return (
    <div className="empty" role="status">
      <h2>{title}</h2>
      {children ? <div className="muted">{children}</div> : null}
      {action ? (
        <div className="form-actions">
          <Link className="button button-primary" href={action.href}>
            {action.label}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Skeleton rows for a table or list, hidden from assistive tech; a status says what's loading. */
export function LoadingState({
  label,
  rows = 5,
  tiles = 0,
}: {
  label: string;
  rows?: number;
  tiles?: number;
}) {
  return (
    <div aria-busy="true">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <span className="skeleton skeleton-title" aria-hidden="true" />
      {tiles ? (
        <div className="tiles" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <span key={i} className="skeleton skeleton-tile" />
          ))}
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Missing values show a dash, never "null" (studio standard 02, partial state). */
export function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
