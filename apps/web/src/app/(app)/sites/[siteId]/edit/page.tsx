import type { Metadata } from 'next';
import Link from 'next/link';
import { getSite, userChoices } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { updateSiteAction } from '../../actions';
import { SiteFields } from '../../site-fields';

export const metadata: Metadata = { title: 'Edit depot' };

export default async function EditSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await requirePermission('settings.edit');
  const siteId = routeId((await params).siteId);
  const site = await orNotFound(getSite(db(), session.actor, siteId));
  const managers = (await userChoices(db(), session.actor)).map((u) => ({
    value: u.id,
    label: u.displayName,
  }));
  return (
    <>
      <p className="breadcrumbs">
        <Link href={`/sites/${site.id}`}>
          {site.code} · {site.name}
        </Link>
      </p>
      <h1>Edit depot details</h1>
      <ActionForm
        action={updateSiteAction.bind(null, site.id, site.row_version)}
        submitLabel="Save changes"
      >
        <SiteFields site={site} managers={managers} />
      </ActionForm>
    </>
  );
}
