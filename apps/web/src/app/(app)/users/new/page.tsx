import type { Metadata } from 'next';
import Link from 'next/link';
import { ALL_SITES_ROLE_CODES, listRoles, siteChoices } from '@northkit/core';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { createUserAction } from '../actions';
import { AccessFields } from '../access-fields';
import { NewUserForm } from './new-user-form';

export const metadata: Metadata = { title: 'Add a user' };

export default async function NewUserPage() {
  const session = await requirePermission('users.create');
  const [roles, sites] = await Promise.all([
    listRoles(db(), session.actor),
    siteChoices(db(), session.actor),
  ]);
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/users">Users</Link>
      </p>
      <h1>Add a user</h1>
      <p className="muted">
        NorthKit makes a temporary password for them and shows it once. They choose their own at
        first sign-in.
      </p>
      <NewUserForm action={createUserAction}>
        <AccessFields
          roles={roles.map((r) => ({ code: r.code, name: r.name, description: r.description }))}
          sites={sites}
          held={[]}
          siteIds={[]}
          allSites={false}
          canGrantAllSites={session.actor.allSites}
          allSitesRoleCodes={ALL_SITES_ROLE_CODES}
        />
      </NewUserForm>
    </>
  );
}
