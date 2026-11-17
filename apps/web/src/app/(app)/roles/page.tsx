import type { Metadata } from 'next';
import Link from 'next/link';
import { can, listRoles } from '@northkit/core';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Roles and access' };

export default async function RolesPage() {
  const session = await requirePermission('users.view');
  const roles = await listRoles(db(), session.actor, { includeArchived: true });
  const canCreate = can(session.actor, 'users.create') && session.actor.allSites;
  return (
    <>
      <div className="page-head">
        <h1>Roles and access</h1>
        {canCreate ? (
          <Link className="button button-primary" href="/roles/new">
            Add a role
          </Link>
        ) : null}
      </div>
      <p className="muted">
        A role is a set of on/off switches for each area (View, Create, Edit, Approve), limited to
        sites. The roles that come with NorthKit can be edited; the Administrator is locked.
      </p>
      <div className="table-wrap" role="region" aria-label="Roles" tabIndex={0}>
        <table className="table table-cards">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Sites</th>
              <th scope="col">Two-factor</th>
              <th scope="col" className="num">
                People
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td data-label="Role">
                  <Link href={`/roles/${r.id}`}>{r.name}</Link>
                  {r.description ? <span className="hint block">{r.description}</span> : null}
                </td>
                <td data-label="Sites">
                  {r.fullAccess
                    ? 'Every site'
                    : r.siteScope === 'all'
                      ? 'Assigned sites'
                      : 'Listed sites'}
                </td>
                <td data-label="Two-factor">{r.requiresMfa ? 'Required' : 'Optional'}</td>
                <td data-label="People" className="num">
                  {r.userCount}
                </td>
                <td data-label="Status">
                  {r.archivedAt ? (
                    <span className="badge">Archived</span>
                  ) : r.fullAccess ? (
                    <span className="badge">Locked</span>
                  ) : (
                    <span className="badge badge-success">In use</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
