import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ACTIONS, AREAS, siteChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { createRoleAction } from '../actions';
import { RoleFields } from '../role-fields';

export const metadata: Metadata = { title: 'Add a role' };

export default async function NewRolePage() {
  const session = await requirePermission('users.create');
  if (!session.actor.allSites) redirect('/roles');
  const sites = await siteChoices(db(), session.actor);
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/roles">Roles and access</Link>
      </p>
      <h1>Add a role</h1>
      <ActionForm action={createRoleAction} submitLabel="Add role" className="stack">
        <RoleFields areas={AREAS} actions={ACTIONS} sites={sites} />
      </ActionForm>
    </>
  );
}
