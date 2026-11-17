import type { Metadata } from 'next';
import Link from 'next/link';
import { can, listSites } from '@northkit/core';
import { EmptyState, orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Depots' };

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const session = await requirePermission('overview.view');
  const showArchived = (await searchParams).archived === '1';
  const sites = await listSites(db(), session.actor, { includeArchived: showArchived });
  const canAdd = can(session.actor, 'settings.create') && session.actor.allSites;

  return (
    <>
      <div className="page-head">
        <h1>Depots</h1>
        <div className="row">
          <Link className="button" href={showArchived ? '/sites' : '/sites?archived=1'}>
            {showArchived ? 'Hide archived depots' : 'Show archived depots'}
          </Link>
          {canAdd ? (
            <Link className="button button-primary" href="/sites/new">
              Add a depot
            </Link>
          ) : null}
        </div>
      </div>
      {sites.length === 0 ? (
        <EmptyState
          title="No depots yet"
          action={canAdd ? { href: '/sites/new', label: 'Add a depot' } : null}
        >
          <p>
            {canAdd
              ? 'Add each depot or branch you run kit from.'
              : 'You aren’t assigned to any depots. Ask an administrator.'}
          </p>
        </EmptyState>
      ) : (
        <div className="table-wrap" role="region" aria-label="Depots" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Name</th>
                <th scope="col">Town</th>
                <th scope="col">Postcode</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td data-label="Reference">
                    <Link href={`/sites/${s.id}`}>{s.code}</Link>
                  </td>
                  <td data-label="Name">{s.name}</td>
                  <td data-label="Town">{orDash(s.town)}</td>
                  <td data-label="Postcode">{orDash(s.postcode)}</td>
                  <td data-label="Status">
                    {s.archived_at ? (
                      <span className="badge">Archived</span>
                    ) : (
                      <span className="badge badge-success">In use</span>
                    )}
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
