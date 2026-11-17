import type { Metadata } from 'next';
import Link from 'next/link';
import { can, intervalText, KIND_RULES_NOTICE, listKinds } from '@northkit/core';
import { InUsePill, StatusPill } from '@/components/badges';
import { EmptyState, orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Kinds' };

export default async function KindsPage() {
  const session = await requirePermission('items.view');
  const kinds = await listKinds(db(), session.actor);
  const canAdd = can(session.actor, 'items.approve');
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Register</p>
          <h1>Kinds</h1>
        </div>
        {canAdd ? (
          <Link className="button button-primary" href="/kinds/new">
            Add a kind
          </Link>
        ) : null}
      </div>
      <p className="muted">{KIND_RULES_NOTICE}</p>
      {kinds.length === 0 ? (
        <EmptyState
          title="No kinds yet"
          action={canAdd ? { href: '/kinds/new', label: 'Add a kind' } : null}
        />
      ) : (
        <div className="table-wrap" role="region" aria-label="Kinds" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Rules</th>
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
                  <td data-label="Kind">
                    <Link href={`/kinds/${k.id}`}>{k.name}</Link>
                  </td>
                  <td data-label="Rules">
                    {orDash(
                      k.rules
                        .map(
                          (r) => `${r.title}: ${intervalText(r.interval_value, r.interval_unit)}`,
                        )
                        .join(' · '),
                    )}
                  </td>
                  <td data-label="Asset prefix">{orDash(k.asset_prefix)}</td>
                  <td data-label="Items" className="num">
                    {k.itemCount.toLocaleString('en-GB')}
                  </td>
                  <td data-label="Status">
                    {k.active ? <InUsePill /> : <StatusPill label="Deactivated" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
