import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Overview } from '@northkit/core';

// The Overview's stat cards and Needs action panel (S1-9), in the NorthSpec house style
// (as NorthSlot): label, big figure, a line of detail, and "Needs attention" in words
// when a figure is above zero. Each card is one link to the list behind its figure.

const n = (value: number) => value.toLocaleString('en-GB');
const plural = (value: number, one: string, many = `${one}s`) =>
  `${n(value)} ${value === 1 ? one : many}`;

export function Kpis({ o }: { o: Overview }) {
  return (
    <>
      <h2 className="visually-hidden">At a glance</h2>
      <ul className="kpis plain">
        <Kpi
          href="/sites"
          label="Depots"
          value={o.totals.depots}
          detail={plural(o.totals.locations, 'location')}
          hero
        />
        <Kpi
          href="/sites"
          label="Locations"
          value={o.totals.locations}
          detail="Stores, vans, yards and job sites"
        />
        <Kpi
          href="/sites"
          label="Vans"
          value={o.totals.vans}
          detail="Kit can be checked out to them"
        />
        {o.totals.people !== null ? (
          <Kpi href="/users" label="People" value={o.totals.people} detail="Signed-in accounts" />
        ) : null}
      </ul>
    </>
  );
}

function Kpi({
  href,
  label,
  value,
  detail,
  attention = false,
  hero = false,
}: {
  href: string;
  label: string;
  value: number;
  detail: ReactNode;
  attention?: boolean;
  /** The screen's one hero figure, in the product accent. */
  hero?: boolean;
}) {
  const flagged = attention && value > 0;
  return (
    <li className="kpi-cell">
      <Link
        className={`kpi${flagged ? ' kpi-attention' : ''}${hero ? ' kpi-hero' : ''}`}
        href={href}
      >
        <span className="kpi-label">{label}</span>{' '}
        <span className="card-figure kpi-value">{n(value)}</span>
        <span className="kpi-detail">{detail}</span>
        {flagged ? <span className="kpi-note">Needs attention</span> : null}
      </Link>
    </li>
  );
}

/** What needs doing now: the narrow panel beside the table. */
export function NeedsAction({ o }: { o: Overview }) {
  const { emptyDepots, lockedAccounts } = o.needsAction;
  const items = emptyDepots.length + (lockedAccounts ?? 0);
  return (
    <section className="needs-action" aria-labelledby="needs-action-heading">
      <h2 id="needs-action-heading">Needs action</h2>
      {items === 0 ? (
        <div className="all-clear" role="status">
          <p>
            <strong>Nothing needs action.</strong>
          </p>
          <p className="muted">Every depot has somewhere to keep kit, and nobody is locked out.</p>
        </div>
      ) : (
        <ul className="plain needs-action-list">
          {emptyDepots.map((d) => (
            <li key={d.siteId}>
              <Link href={`/sites/${d.siteId}/locations`} className="card card-link">
                <span className="stat-line">
                  <span className="pill pill-warning">Set up</span>
                  <span>
                    {d.code} · {d.name} has no stores, vans or yards yet
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {lockedAccounts ? (
            <li>
              <Link href="/users" className="card card-link">
                <span className="stat-line">
                  <span className="pill pill-danger">Locked</span>
                  <span>{plural(lockedAccounts, 'account')} locked after failed sign-ins</span>
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
