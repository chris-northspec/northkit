import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { can, countableLocations, listStocktakes } from '@northkit/core';
import { EmptyState } from '@/components/states';
import { StartCount } from '@/components/move/start-count';
import { CardHead, Delta } from '@/components/ui/primitives';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { n, ukMoment } from '@/lib/format';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Stocktake' };

/**
 * Stocktake by location (S3-5, CO-5, A17): start a count of a store, cage, yard or van,
 * scan everything that is physically there, then review what was found, what wasn't and
 * what turned up where it shouldn't be. Each location keeps its last-counted date; the
 * ones past the recount setting show in Needs action. Counting works offline.
 */
export default async function StocktakePage() {
  const session = await requirePermission('checkouts.view');
  const canCount = can(session.actor, 'checkouts.create');
  const [locations, recent] = await Promise.all([
    countableLocations(db(), session.actor),
    listStocktakes(db(), session.actor, 20),
  ]);
  const due = locations.filter((l) => l.due).length;
  const counting = recent.filter((s) => s.status === 'counting');
  const closed = recent.filter((s) => s.status === 'closed');

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Movements</p>
          <h1>Stocktake</h1>
        </div>
      </div>
      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">Locations</span>
          <span className="figure">{n(locations.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Due a count</span>
          <span className="figure">{n(due)}</span>
        </li>
        <li>
          <span className="eyebrow">Counting now</span>
          <span className="figure">{n(counting.length)}</span>
        </li>
      </ul>
      {canCount ? <OfflineReadyNote path="/stocktake" /> : null}

      {counting.length ? (
        <section className="card" aria-labelledby="counting-h">
          <CardHead
            icon={ClipboardList}
            headingId="counting-h"
            title="Being counted"
            meta="Carry on scanning, or review the result."
          />
          <ul className="scan-list">
            {counting.map((s) => (
              <li key={s.id} className="scan-item">
                <span className="grow">
                  <strong>{s.locationName}</strong>{' '}
                  <span className="muted small">
                    {s.siteCode} · started {ukMoment(s.startedAt)} · {n(s.scanned)} scanned
                  </span>
                </span>
                {canCount ? (
                  <Link className="button" href={`/stocktake/count?id=${s.id}&loc=${s.locationId}`}>
                    Keep scanning
                  </Link>
                ) : null}
                <Link className="button button-primary" href={`/stocktake/${s.id}`}>
                  Review result
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {locations.length === 0 ? (
        <EmptyState title="No locations to count yet" picture="empty-items">
          <p>Add a store, yard or van to a depot first.</p>
        </EmptyState>
      ) : (
        <section className="table-card" aria-labelledby="locs-h">
          <div className="table-toolbar">
            <CardHead
              icon={ClipboardList}
              headingId="locs-h"
              title="Locations"
              meta="Count each one now and then, so the register matches the shelves."
            />
          </div>
          <div className="table-wrap" role="region" aria-label="Locations" tabIndex={0}>
            <table className="dt">
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  <th scope="col">Depot</th>
                  <th scope="col">Last counted</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-first">
                      <span className="cell-text">
                        <span className="cell-main">{l.name}</span>
                        <span className="cell-sub">{l.kind}</span>
                      </span>
                    </td>
                    <td data-label="Depot">{l.siteCode}</td>
                    <td data-label="Last counted">
                      {l.lastCountedAt ? ukMoment(l.lastCountedAt) : 'Never'}{' '}
                      {l.due ? <Delta tone="attention">Due a count</Delta> : null}
                    </td>
                    <td data-label="Actions">
                      {canCount ? (
                        l.counting ? (
                          <Link
                            className="button"
                            href={`/stocktake/count?id=${l.counting}&loc=${l.id}`}
                          >
                            Keep scanning
                          </Link>
                        ) : (
                          <StartCount locationId={l.id} name={l.name} />
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {closed.length ? (
        <section className="card space-above" aria-labelledby="closed-h">
          <CardHead headingId="closed-h" eyebrow="Recent" title="Closed counts" />
          <ul className="scan-list">
            {closed.map((s) => (
              <li key={s.id} className="scan-item">
                <span className="grow">
                  <Link href={`/stocktake/${s.id}`}>
                    <strong>{s.locationName}</strong>
                  </Link>{' '}
                  <span className="muted small">
                    {s.siteCode} · {s.closedAt ? ukMoment(s.closedAt) : ''} · {n(s.found ?? 0)}{' '}
                    found, {n(s.notFound ?? 0)} not found, {n(s.unexpected ?? 0)} not expected
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
