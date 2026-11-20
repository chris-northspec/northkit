import type { Metadata } from 'next';
import Link from 'next/link';
import { Hand, LogIn } from 'lucide-react';
import { can, myKit } from '@northkit/core';
import { ItemStatusPill } from '@/components/badges';
import { EmptyState } from '@/components/states';
import { OfflineReadyNote } from '@/components/offline/offline-ready-note';
import { CardHead } from '@/components/ui/primitives';
import { KindChip } from '@/components/ui/kind-icon';
import { n, plural, ukDay } from '@/lib/format';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'My kit' };

/**
 * My kit (S3-4): what the signed-in person holds, and what is in their van, with what is
 * due back. Overdue first, so the thing to return is at the top.
 */
export default async function MyKitPage() {
  const session = await requirePermission('checkouts.view');
  const items = await myKit(db(), session.actor);
  const overdue = items.filter((i) => i.overdue).length;
  const canMove = can(session.actor, 'checkouts.create');

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Kit</p>
          <h1>My kit</h1>
        </div>
        {canMove ? (
          <div className="page-head-actions sticky-bottom">
            <Link className="button button-primary" href="/move/out">
              Check something out
            </Link>
          </div>
        ) : null}
      </div>

      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">I am holding</span>
          <span className="figure">
            {n(items.length)}{' '}
            <span className="figure-unit">{items.length === 1 ? 'item' : 'items'}</span>
          </span>
        </li>
        <li>
          <span className="eyebrow">Overdue</span>
          <span className="figure">{n(overdue)}</span>
        </li>
      </ul>

      {items.length === 0 ? (
        <EmptyState title="You aren’t holding any kit" picture="all-clear">
          <p>
            When you check something out, or it is in your van, it appears here with its due-back
            date.
          </p>
        </EmptyState>
      ) : (
        <section className="card" aria-labelledby="mine-h">
          <CardHead
            icon={Hand}
            headingId="mine-h"
            title="What I hold"
            meta={`${plural(items.length, 'item')}, soonest due first`}
          />
          <ul className="scan-list">
            {items.map((i) => (
              <li key={i.id} className="scan-item">
                <KindChip kindName={i.kindName} />
                <span className="grow">
                  <Link href={`/items/${i.id}`}>
                    <strong>{i.assetNumber}</strong>
                  </Link>
                  <span className="muted small">
                    {' '}
                    {i.kindName}
                    {i.placeName ? ` · in ${i.placeName}` : ''}
                  </span>
                  <br />
                  <span className="small">
                    {i.dueBackOn ? `Due back ${ukDay(i.dueBackOn)}` : 'No due-back date'}
                  </span>
                </span>
                <ItemStatusPill status={i.status} />
                {i.overdue ? <span className="badge badge-danger">Overdue</span> : null}
                {canMove ? (
                  <Link className="button" href={`/move/in?item=${i.id}`}>
                    <LogIn size={16} className="icon" aria-hidden="true" />
                    Check in
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <OfflineReadyNote path="/my-kit" />
    </>
  );
}
