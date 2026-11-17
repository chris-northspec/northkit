import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getUser, listRoles, siteChoices } from '@northkit/core';
import { ActionForm, Field } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import {
  resetMfaAction,
  resetPasswordAction,
  setAccessAction,
  setArchivedAction,
  updateUserAction,
} from '../actions';
import { AccessFields } from '../access-fields';

export const metadata: Metadata = { title: 'User' };

const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
});

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await requirePermission('users.view');
  const user = await orNotFound(getUser(db(), session.actor, routeId((await params).userId)));
  const saved = (await searchParams).saved === '1';
  const [roles, sites] = await Promise.all([
    listRoles(db(), session.actor),
    siteChoices(db(), session.actor),
  ]);
  const edit = can(session.actor, 'users.edit');
  const self = user.id === session.user.id;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/users">Users</Link>
      </p>
      <div className="page-head">
        <h1>{user.display_name}</h1>
        {user.archived_at ? <span className="badge badge-closed">Archived</span> : null}
      </div>
      {saved ? (
        <p className="form-message" role="status">
          Saved.
        </p>
      ) : null}
      <dl className="details">
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Roles</dt>
        <dd>{user.roles.map((r) => r.name).join(', ') || 'None'}</dd>
        <dt>Sites</dt>
        <dd>
          {user.all_sites
            ? 'Every site'
            : sites
                .filter((s) => user.siteIds.includes(s.id))
                .map((s) => s.code)
                .join(', ') || 'None'}
        </dd>
        <dt>Two-factor sign-in</dt>
        <dd>{user.mfa_enabled_at ? 'On' : 'Off'}</dd>
        <dt>Last sign-in</dt>
        <dd>{user.last_login_at ? ukDateTime.format(user.last_login_at) : 'Never'}</dd>
      </dl>

      {edit && !user.archived_at ? (
        <>
          <section className="panel" aria-labelledby="details-heading">
            <h2 id="details-heading">Details</h2>
            <ActionForm
              action={updateUserAction.bind(null, user.id, user.row_version)}
              submitLabel="Save details"
            >
              <div className="form-grid">
                <Field name="displayName" label="Name" defaultValue={user.display_name} required />
                <Field name="email" label="Email" type="email" defaultValue={user.email} required />
                <Field name="phone" label="Phone" type="tel" defaultValue={user.phone ?? ''} />
              </div>
            </ActionForm>
          </section>

          {self ? (
            <p className="notice notice-info">
              You can’t change your own roles, sites or archive yourself. Ask another administrator.
            </p>
          ) : (
            <>
              <section className="panel" aria-labelledby="access-heading">
                <h2 id="access-heading">Access</h2>
                <ActionForm
                  action={setAccessAction.bind(null, user.id)}
                  submitLabel="Save access"
                  className="stack"
                >
                  <AccessFields
                    roles={roles.map((r) => ({
                      code: r.code,
                      name: r.name,
                      description: r.description,
                    }))}
                    sites={sites}
                    held={user.roles.map((r) => r.code)}
                    siteIds={user.siteIds}
                    allSites={user.all_sites}
                    canGrantAllSites={session.actor.allSites}
                  />
                </ActionForm>
              </section>

              <section className="panel" aria-labelledby="security-heading">
                <h2 id="security-heading">Sign-in help</h2>
                <div className="stack">
                  <ActionForm
                    action={resetPasswordAction.bind(null, user.id)}
                    submitLabel="Give them a temporary password"
                    submitClassName="button"
                  />
                  {user.mfa_enabled_at ? (
                    <ActionForm
                      action={resetMfaAction.bind(null, user.id)}
                      submitLabel="Reset two-factor sign-in"
                      submitClassName="button"
                    />
                  ) : null}
                </div>
              </section>
            </>
          )}
        </>
      ) : null}

      {edit && !self ? (
        <section className="panel" aria-labelledby="archive-heading">
          <h2 id="archive-heading">
            {user.archived_at ? 'Restore this user' : 'Archive this user'}
          </h2>
          <p className="muted">
            {user.archived_at
              ? 'They can sign in again with their password.'
              : 'They are signed out at once and can’t sign in. Their name stays on records they made.'}
          </p>
          <ActionForm
            action={setArchivedAction.bind(null, user.id, user.row_version, !user.archived_at)}
            submitLabel={user.archived_at ? 'Restore user' : 'Archive user'}
            submitClassName={user.archived_at ? 'button' : 'button button-danger'}
          />
        </section>
      ) : null}
    </>
  );
}
