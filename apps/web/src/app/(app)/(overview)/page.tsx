import type { Metadata } from 'next';
import { can, overview, type DepotRow } from '@northkit/core';
import { Kpis, NeedsAction } from '@/components/overview/overview-cards';
import { EmptyState } from '@/components/states';
import { db } from '@/lib/server/db';
import { requireSession, siteSelection } from '@/lib/server/session';
import { chooseSiteAction } from '../site-actions';

export const metadata: Metadata = { title: 'Overview' };

const n = (value: number) => value.toLocaleString('en-GB');
const shortWhen = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(d);

/**
 * The Overview (S1-9): four stat cards, then the depots table beside a Needs action
 * panel, for the sites in the site filter. Every figure comes from the database. In
 * Sprint 1 it counts depots, locations and people; items out, overdue returns and
 * inspections due take the cards' places from Sprints 2 to 4.
 */
export default async function OverviewPage() {
  const session = await requireSession();
  const selection = await siteSelection();
  const { current } = selection;
  const heading = current
    ? `${current.code} · ${current.name}`
    : selection.allLabel.replace(/ \(\d+\)$/, '');

  if (!can(session.actor, 'overview.view') || selection.sites.length === 0) {
    return (
      <>
        <h1>Overview</h1>
        <EmptyState title="You’re not assigned to any depots yet">
          <p>Ask an administrator to add you to the depots you work at.</p>
        </EmptyState>
      </>
    );
  }

  const now = new Date();
  const o = await overview(db(), session.actor, current ? [current.id] : null, now);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Overview · Figures at {shortWhen(now)}</p>
          <h1>{heading}</h1>
        </div>
      </div>

      <Kpis o={o} />

      {/* As NorthSlot: the wide table beside a narrower Needs action panel; stacked on
          smaller screens. */}
      <div className="split">
        <div className="split-main">
          <DepotsPanel depots={o.depots} />
        </div>
        <NeedsAction o={o} />
      </div>
    </>
  );
}

/** One row per depot: choosing one sets the site filter and stays on the Overview. */
function DepotsPanel({ depots }: { depots: DepotRow[] }) {
  return (
    <section aria-labelledby="depots-heading">
      <h2 id="depots-heading">Depots</h2>
      <div className="table-wrap" role="region" aria-label="Depots" tabIndex={0}>
        <table className="table table-cards sites-table">
          <thead>
            <tr>
              <th scope="col">Depot</th>
              <th scope="col" className="num">
                Stores
              </th>
              <th scope="col" className="num">
                Vans
              </th>
              <th scope="col" className="num">
                Yards
              </th>
              <th scope="col" className="num">
                Job sites
              </th>
            </tr>
          </thead>
          <tbody>
            {depots.map((d) => (
              <tr key={d.siteId}>
                <td data-label="Depot">
                  <form action={chooseSiteAction}>
                    <input type="hidden" name="siteId" value={d.siteId} />
                    <button type="submit" className="button-link site-choose">
                      <span className="visually-hidden">Show </span>
                      {d.code} · {d.name}
                    </button>
                  </form>
                </td>
                <td data-label="Stores" className="num">
                  {n(d.stores)}
                </td>
                <td data-label="Vans" className="num">
                  {n(d.vans)}
                </td>
                <td data-label="Yards" className="num">
                  {n(d.yards)}
                </td>
                <td data-label="Job sites" className="num">
                  {n(d.jobSites)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
