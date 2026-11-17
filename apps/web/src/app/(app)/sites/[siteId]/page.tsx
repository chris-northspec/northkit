import type { Metadata } from 'next';
import Link from 'next/link';
import { can, getSite } from '@northkit/core';
import { ActionForm } from '@/components/form/action-form';
import { orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { setSiteArchivedAction } from '../actions';

export const metadata: Metadata = { title: 'Depot' };

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await requirePermission('overview.view');
  const siteId = routeId((await params).siteId);
  const site = await orNotFound(getSite(db(), session.actor, siteId));
  const edit = can(session.actor, 'settings.edit');
  const address = [site.address_line_1, site.address_line_2, site.town, site.postcode]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/sites">Depots</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>
            {site.code} · {site.name}
          </h1>
          {site.archived_at ? <span className="badge">Archived</span> : null}
        </div>
        <div className="row">
          <Link className="button button-primary" href={`/sites/${site.id}/locations`}>
            Locations
          </Link>
          {edit ? (
            <Link className="button" href={`/sites/${site.id}/edit`}>
              Edit details
            </Link>
          ) : null}
        </div>
      </div>

      <section className="panel" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        <dl className="details">
          <dt>Address</dt>
          <dd>{orDash(address)}</dd>
          <dt>Time zone</dt>
          <dd>{site.time_zone}</dd>
          <dt>Phone</dt>
          <dd>{orDash(site.phone)}</dd>
          <dt>Email</dt>
          <dd>{orDash(site.email)}</dd>
          <dt>Notes</dt>
          <dd>{orDash(site.notes)}</dd>
        </dl>
      </section>

      {edit ? (
        <section className="panel" aria-labelledby="archive-heading">
          <h2 id="archive-heading">
            {site.archived_at ? 'Restore this depot' : 'Archive this depot'}
          </h2>
          <p className="muted">
            {site.archived_at
              ? 'Bring the depot back into use.'
              : 'Archived depots keep their history but drop out of lists and the depot filter. Nothing is deleted.'}
          </p>
          <ActionForm
            action={setSiteArchivedAction.bind(null, site.id, site.row_version, !site.archived_at)}
            submitLabel={site.archived_at ? 'Restore depot' : 'Archive depot'}
            submitClassName={site.archived_at ? 'button' : 'button button-danger'}
          />
        </section>
      ) : null}
    </>
  );
}
