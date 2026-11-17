import type { Metadata } from 'next';
import Link from 'next/link';
import { can, listUsers } from '@northkit/core';
import { EmptyState } from '@/components/states';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Users' };

const ukDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Europe/London' });

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const session = await requirePermission('users.view');
  const showArchived = (await searchParams).archived === '1';
  const users = await listUsers(db(), session.actor, { includeArchived: showArchived });
  const canAdd = can(session.actor, 'users.create');
  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
        <div className="row">
          <Link className="button" href={showArchived ? '/users' : '/users?archived=1'}>
            {showArchived ? 'Hide archived users' : 'Show archived users'}
          </Link>
          {canAdd ? (
            <Link className="button button-primary" href="/users/new">
              Add a user
            </Link>
          ) : null}
        </div>
      </div>
      {users.length === 0 ? (
        <EmptyState
          title="No users to show"
          action={canAdd ? { href: '/users/new', label: 'Add a user' } : null}
        />
      ) : (
        <div className="table-wrap" role="region" aria-label="Users" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Roles</th>
                <th scope="col">Two-factor</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label="Name">
                    <Link href={`/users/${u.id}`}>{u.display_name}</Link>
                  </td>
                  <td data-label="Email">{u.email}</td>
                  <td data-label="Roles">{u.roles.map((r) => r.name).join(', ') || '—'}</td>
                  <td data-label="Two-factor">{u.mfa_enabled_at ? 'On' : 'Off'}</td>
                  <td data-label="Last sign-in">
                    {u.last_login_at ? ukDate.format(u.last_login_at) : 'Never'}
                  </td>
                  <td data-label="Status">
                    {u.archived_at ? (
                      <span className="badge">Archived</span>
                    ) : u.locked_until && u.locked_until > new Date() ? (
                      <span className="badge badge-warning">Locked</span>
                    ) : (
                      <span className="badge badge-success">Active</span>
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
