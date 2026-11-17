import Link from 'next/link';
import type { Chip } from '@/lib/list-filters';

/** The filters a list is showing, each removable with one tap (B-3). */
export function FilterChips({ chips, count }: { chips: Chip[]; count: string }) {
  return (
    <div className="list-summary">
      <p className="list-count" role="status">
        {count}
      </p>
      {chips.length ? (
        <ul className="chips" aria-label="Filters in use">
          {chips.map((chip) => (
            <li key={chip.label}>
              <Link
                className="chip"
                href={chip.removeHref}
                aria-label={`Remove filter: ${chip.label}`}
              >
                <span>{chip.label}</span>
                <span aria-hidden="true" className="chip-x">
                  ×
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
