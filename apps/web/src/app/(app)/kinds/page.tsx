import type { Metadata } from 'next';
import Link from 'next/link';
import { can, intervalText, KIND_RULES_NOTICE, listKinds } from '@northkit/core';
import { InUsePill, StatusPill } from '@/components/badges';
import { EmptyState, orDash } from '@/components/states';
import { DensityToggle } from '@/components/ui/density-toggle';
import { KindChip } from '@/components/ui/kind-icon';
import { n } from '@/lib/format';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Kinds' };

export default async function KindsPage() {
  const session = await requirePermission('items.view');
  const kinds = await listKinds(db(), session.actor);
  const canAdd = can(session.actor, 'items.approve');
  const total = kinds.reduce((a, k) => a + k.itemCount, 0);
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Register</p>
          <h1>Kinds</h1>
        </div>
        {canAdd ? (
          <div className="page-head-actions sticky-bottom">
            <Link className="button button-primary" href="/kinds/new">
              Add a kind
            </Link>
          </div>
        ) : null}
      </div>
      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">Kinds</span>
          <span className="figure">{n(kinds.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Items of these kinds</span>
          <span className="figure">{n(total)}</span>
        </li>
      </ul>
      <p className="muted">{KIND_RULES_NOTICE}</p>
      {kinds.length === 0 ? (
        <EmptyState
          title="No kinds yet"
          picture="empty-items"
          action={canAdd ? { href: '/kinds/new', label: 'Add a kind' } : null}
        />
      ) : (
        <section className="table-card" id="kinds-card" aria-label="Kinds">
          <div className="table-toolbar">
            <p className="list-count grow" role="status">
              {n(kinds.length)} {kinds.length === 1 ? 'kind' : 'kinds'}
            </p>
            <DensityToggle targetId="kinds-card" />
          </div>
          <div className="table-wrap" role="region" aria-label="Kinds" tabIndex={0}>
            <table className="dt">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Asset prefix</th>
                  <th scope="col" className="num">
                    Items
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((k) => (
                  <tr key={k.id}>
                    <td className="cell-first">
                      <div className="cell-identity">
                        <KindChip kindName={k.name} />
                        <span className="cell-text">
                          <Link className="cell-main" href={`/kinds/${k.id}`}>
                            {k.name}
                          </Link>
                          <span className="cell-sub">
                            {orDash(
                              k.rules
                                .map(
                                  (r) =>
                                    `${r.title}: ${intervalText(r.interval_value, r.interval_unit)}`,
                                )
                                .join(' · '),
                            )}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td data-label="Asset prefix">{orDash(k.asset_prefix)}</td>
                    <td data-label="Items" className="num">
                      {n(k.itemCount)}
                    </td>
                    <td data-label="Status">
                      {k.active ? <InUsePill /> : <StatusPill label="Deactivated" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
