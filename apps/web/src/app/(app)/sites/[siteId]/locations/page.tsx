import type { Metadata } from 'next';
import Link from 'next/link';
import {
  can,
  getLocation,
  getSite,
  KIND_LABELS,
  listLocations,
  locationAncestors,
  LOCATION_KINDS,
} from '@northkit/core';
import { isUuid } from '@northkit/db';
import { ActionForm, Field, SelectField } from '@/components/form/action-form';
import { EmptyState, orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import { createLocationAction } from './actions';

export const metadata: Metadata = { title: 'Locations' };

/**
 * The places kit can be at a depot (stores, vans, yards, job sites), one level at a
 * time: the top of the depot, or the children of ?parent=. With ?q= it searches the
 * whole depot instead.
 */
export default async function LocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ parent?: string; q?: string }>;
}) {
  const session = await requirePermission('locations.view');
  const siteId = routeId((await params).siteId);
  const { parent: parentParam, q } = await searchParams;
  const parentId = parentParam && isUuid(parentParam) ? parentParam : null;
  const site = await orNotFound(getSite(db(), session.actor, siteId));
  const [parent, trail, rows] = await Promise.all([
    parentId ? orNotFound(getLocation(db(), session.actor, parentId)) : null,
    parentId ? locationAncestors(db(), session.actor, parentId) : [],
    listLocations(db(), session.actor, siteId, { parentId, search: q }),
  ]);
  const create = can(session.actor, 'locations.create');
  const here = `/sites/${site.id}/locations`;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/sites">Depots</Link> › <Link href={`/sites/${site.id}`}>{site.code}</Link>
      </p>
      <div className="page-head">
        <h1>Locations at {site.code}</h1>
      </div>

      <form method="get" action={here} role="search" className="search">
        <label htmlFor="location-search" className="visually-hidden">
          Search locations at {site.code}
        </label>
        <input
          id="location-search"
          name="q"
          type="search"
          className="input"
          defaultValue={q ?? ''}
          placeholder="Code or name"
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>

      <nav aria-label="Location path" className="breadcrumbs">
        {q ? (
          <>
            Results for “{q}” · <Link href={here}>Back to the top</Link>
          </>
        ) : (
          <>
            <Link href={here}>Top of {site.code}</Link>
            {trail.map((a) => (
              <span key={a.id}>
                {' › '}
                <Link href={`${here}?parent=${a.id}`}>{a.code}</Link>
              </span>
            ))}
            {parent ? (
              <>
                {' › '}
                <Link href={`${here}/${parent.id}`}>{parent.code}</Link>
              </>
            ) : null}
          </>
        )}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title={
            q
              ? 'No locations match'
              : parent
                ? `Nothing under ${parent.code} yet`
                : 'No locations yet'
          }
        >
          <p>
            {q
              ? 'Try part of the code or name.'
              : 'Locations are where kit is kept or taken to: stores, vans, yards and job sites. Add the first one below.'}
          </p>
        </EmptyState>
      ) : (
        <div className="table-wrap" role="region" aria-label="Locations" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">Reference</th>
                <th scope="col" className="num">
                  Under it
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td data-label="Code">
                    <Link href={`${here}/${l.id}`}>{l.code}</Link>
                  </td>
                  <td data-label="Name">{l.name}</td>
                  <td data-label="Kind">{KIND_LABELS[l.kind]}</td>
                  <td data-label="Reference">{orDash(l.reference)}</td>
                  <td data-label="Under it" className="num">
                    {l.child_count ? (
                      <Link href={`${here}?parent=${l.id}`}>{l.child_count}</Link>
                    ) : (
                      '0'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {create && !q ? (
        <section className="panel space-above" aria-labelledby="add-heading">
          <h2 id="add-heading">Add a location {parent ? `under ${parent.code}` : 'at the top'}</h2>
          <ActionForm action={createLocationAction.bind(null, site.id)} submitLabel="Add location">
            {parent ? <input type="hidden" name="parentId" value={parent.id} /> : null}
            <div className="form-grid">
              <Field
                name="code"
                label="Code"
                hint="Printed on labels, e.g. VAN-03."
                autoCapitalize="characters"
                required
              />
              <Field name="name" label="Name" hint="As staff know it, e.g. Van 3." required />
              <SelectField
                name="kind"
                label="Kind"
                options={LOCATION_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                defaultValue={parent ? 'store' : 'van'}
              />
              <Field
                name="reference"
                label="Reference"
                hint="A vehicle registration or job number, if it has one."
              />
            </div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
