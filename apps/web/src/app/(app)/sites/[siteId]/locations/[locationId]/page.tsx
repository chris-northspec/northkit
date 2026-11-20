import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  can,
  getLocation,
  KIND_LABELS,
  locationAncestors,
  LOCATION_KINDS,
  userChoices,
} from '@northkit/core';
import { ActionForm, Field, SelectField } from '@/components/form/action-form';
import { orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { setLocationArchivedAction, updateLocationAction } from '../actions';

export const metadata: Metadata = { title: 'Location' };

export default async function LocationPage({
  params,
}: {
  params: Promise<{ siteId: string; locationId: string }>;
}) {
  const session = await requirePermission('locations.view');
  const p = await params;
  const siteId = routeId(p.siteId);
  const location = await orNotFound(getLocation(db(), session.actor, routeId(p.locationId)));
  if (location.site_id !== siteId) notFound();
  const trail = await locationAncestors(db(), session.actor, location.id);
  const edit = can(session.actor, 'locations.edit');
  const people = edit && location.kind === 'van' ? await userChoices(db(), session.actor) : [];
  const list = `/sites/${siteId}/locations`;

  return (
    <>
      <nav aria-label="Location path" className="breadcrumbs">
        <Link href={list}>Locations</Link>
        {trail.map((a) => (
          <span key={a.id}>
            {' › '}
            <Link href={`${list}/${a.id}`}>{a.code}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <h1>
            {location.code} · {location.name}
          </h1>
          {location.archived_at ? <span className="badge">Archived</span> : null}
        </div>
        <Link className="button" href={`${list}?parent=${location.id}`}>
          What’s under it ({location.child_count})
        </Link>
      </div>
      <dl className="details">
        <dt>Kind</dt>
        <dd>{KIND_LABELS[location.kind]}</dd>
        <dt>Reference</dt>
        <dd>{orDash(location.reference)}</dd>
        {location.kind === 'van' ? (
          <>
            <dt>Looked after by</dt>
            <dd>{orDash(people.find((p) => p.id === location.assigned_user_id)?.displayName)}</dd>
          </>
        ) : null}
        <dt>Inside</dt>
        <dd>{orDash(location.parent_code)}</dd>
        <dt>Notes</dt>
        <dd>{orDash(location.notes)}</dd>
      </dl>

      {edit && !location.archived_at ? (
        <section className="panel" aria-labelledby="edit-heading">
          <h2 id="edit-heading">Edit</h2>
          <ActionForm
            action={updateLocationAction.bind(null, siteId, location.id, location.row_version)}
            submitLabel="Save changes"
          >
            <div className="form-grid">
              <Field
                name="code"
                label="Code"
                defaultValue={location.code}
                autoCapitalize="characters"
                required
              />
              <Field name="name" label="Name" defaultValue={location.name} required />
              <SelectField
                name="kind"
                label="Kind"
                options={LOCATION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                defaultValue={location.kind}
              />
              <Field
                name="reference"
                label="Reference"
                hint="A vehicle registration or job number."
                defaultValue={location.reference ?? ''}
              />
              {location.kind === 'van' ? (
                <SelectField
                  name="assignedUserId"
                  label="Looked after by"
                  hint="Whoever drives this van: “To my van” at check-out means this van."
                  options={[
                    { value: '', label: 'Nobody in particular' },
                    ...people.map((p) => ({ value: p.id, label: p.displayName })),
                  ]}
                  defaultValue={location.assigned_user_id ?? ''}
                />
              ) : null}
              {/* Keeps the parent; moving a location is done from its new parent's page later. */}
              {location.parent_id ? (
                <input type="hidden" name="parentId" value={location.parent_id} />
              ) : null}
            </div>
            <Field
              name="notes"
              label="Notes"
              defaultValue={location.notes ?? ''}
              maxLength={2000}
            />
          </ActionForm>
        </section>
      ) : null}

      {edit ? (
        <section className="panel" aria-labelledby="archive-heading">
          <h2 id="archive-heading">{location.archived_at ? 'Restore' : 'Archive'}</h2>
          <p className="muted">
            {location.archived_at
              ? 'Bring this location back into use.'
              : 'Archived locations keep their history but can’t be chosen for new work. Archive what’s under it first.'}
          </p>
          <ActionForm
            action={setLocationArchivedAction.bind(
              null,
              siteId,
              location.id,
              location.row_version,
              !location.archived_at,
            )}
            submitLabel={location.archived_at ? 'Restore location' : 'Archive location'}
            submitClassName={location.archived_at ? 'button' : 'button button-danger'}
          />
        </section>
      ) : null}
    </>
  );
}
