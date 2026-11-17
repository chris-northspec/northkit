import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { userChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { createSiteAction } from '../actions';
import { SiteFields } from '../site-fields';

export const metadata: Metadata = { title: 'Add a depot' };

export default async function NewSitePage() {
  const session = await requirePermission('settings.create');
  if (!session.actor.allSites) redirect('/sites');
  const managers = (await userChoices(db(), session.actor)).map((u) => ({
    value: u.id,
    label: u.displayName,
  }));
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/sites">Depots</Link>
      </p>
      <h1>Add a depot</h1>
      <ActionForm action={createSiteAction} submitLabel="Add depot" pendingLabel="Adding…">
        <SiteFields managers={managers} />
      </ActionForm>
    </>
  );
}
