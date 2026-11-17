import type { Metadata } from 'next';
import Link from 'next/link';
import {
  can,
  ITEM_STATUSES,
  listItems,
  listKinds,
  siteChoices,
  STATUS_LABELS,
} from '@northkit/core';
import { FilterChips } from '@/components/filter-chips';
import { ItemStatusPill } from '@/components/badges';
import { EmptyState, orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { type ItemParams, filterParams, itemChips, itemFilters } from '@/lib/server/item-params';
import { requirePermission } from '@/lib/server/session';
import { hrefWith, firstValues } from '@/lib/list-filters';
import { LABEL_LAYOUTS } from '@northkit/core';

export const metadata: Metadata = { title: 'Items' };

/**
 * The item register (S2-2): search and filters (kind, depot, status, owned or hired in,
 * kits), paging, a CSV of the filtered list and a sheet of labels for it. The filters live
 * in the address, so a bookmark shows the same list.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission('items.view');
  const params = firstValues(await searchParams) as ItemParams;
  const filters = itemFilters(params);
  const [result, kinds, depots] = await Promise.all([
    listItems(db(), session.actor, filters),
    listKinds(db(), session.actor),
    siteChoices(db(), session.actor),
  ]);
  const chips = itemChips(params, {
    kinds: new Map(kinds.map((k) => [k.id, k.name])),
    depots: new Map(depots.map((d) => [d.id, `${d.code} · ${d.name}`])),
  });
  const canAdd = can(session.actor, 'items.create');
  const base = filterParams(params);
  const filtered = chips.length > 0;
  const count = `${result.total.toLocaleString('en-GB')} ${result.total === 1 ? 'item' : 'items'}`;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Register</p>
          <h1>Items</h1>
        </div>
        <div className="row">
          {canAdd ? (
            <Link className="button button-primary" href="/items/new">
              Add an item
            </Link>
          ) : null}
        </div>
      </div>

      <form method="get" action="/items" role="search" className="filter-bar">
        <div className="field">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            className="input"
            defaultValue={params.q ?? ''}
            placeholder="Asset number, serial, make or model"
          />
        </div>
        <div className="field">
          <label htmlFor="kind">Kind</label>
          <select id="kind" name="kind" className="input" defaultValue={params.kind ?? ''}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        {depots.length > 1 ? (
          <div className="field">
            <label htmlFor="depot">Depot</label>
            <select id="depot" name="depot" className="input" defaultValue={params.depot ?? ''}>
              <option value="">All depots</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" className="input" defaultValue={params.status ?? ''}>
            <option value="">Any status</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="own">Ownership</label>
          <select id="own" name="own" className="input" defaultValue={params.own ?? ''}>
            <option value="">Owned or hired in</option>
            <option value="owned">Owned</option>
            <option value="hired_in">Hired in</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="kits">Kits</label>
          <select id="kits" name="kits" className="input" defaultValue={params.kits ?? ''}>
            <option value="">All items</option>
            <option value="kits">Kits only</option>
            <option value="in_kit">Items in a kit</option>
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="button">
            Filter
          </button>
        </div>
      </form>

      <FilterChips chips={chips} count={count} />

      {result.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No items match"
            picture="no-results"
            action={{ href: '/items', label: 'Clear the filters' }}
          >
            <p>Try a shorter search, or remove a filter.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="No items in the register yet"
            picture="empty-items"
            action={canAdd ? { href: '/items/new', label: 'Add the first item' } : null}
          >
            <p>
              {canAdd ? (
                <>
                  Add items one at a time, or <Link href="/import">import a spreadsheet</Link>.
                </>
              ) : (
                'Ask a Kit Manager to add the kit you use.'
              )}
            </p>
          </EmptyState>
        )
      ) : (
        <>
          <div className="table-wrap" role="region" aria-label="Items" tabIndex={0}>
            <table className="table table-cards">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Photo</span>
                  </th>
                  <th scope="col">Asset number</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Make and model</th>
                  <th scope="col">Depot</th>
                  <th scope="col">Location</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Photo">
                      {r.photoId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="item-thumb"
                          src={`/item-photos/${r.photoId}?v=thumb`}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                        />
                      ) : (
                        <span className="item-thumb-none" aria-hidden="true" />
                      )}
                    </td>
                    <td data-label="Asset number">
                      <Link href={`/items/${r.id}`}>{r.assetNumber}</Link>
                      {r.isKit ? (
                        <span className="muted small"> · kit of {r.partCount}</span>
                      ) : null}
                      {r.kitAssetNumber ? (
                        <span className="muted small"> · in {r.kitAssetNumber}</span>
                      ) : null}
                    </td>
                    <td data-label="Kind">{r.kindName}</td>
                    <td data-label="Make and model">
                      {orDash([r.make, r.model].filter(Boolean).join(' '))}
                    </td>
                    <td data-label="Depot">{r.siteCode}</td>
                    <td data-label="Location">{orDash(r.locationCode)}</td>
                    <td data-label="Status">
                      <ItemStatusPill status={r.status} />
                      {r.ownership === 'hired_in' ? (
                        <span className="muted small"> · hired in</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.pages > 1 ? (
            <nav className="pager" aria-label="Pages">
              {result.page > 1 ? (
                <Link
                  className="button"
                  href={hrefWith('/items', base, { page: String(result.page - 1) })}
                >
                  Previous
                </Link>
              ) : null}
              <span role="status">
                Page {result.page} of {result.pages}
              </span>
              {result.page < result.pages ? (
                <Link
                  className="button"
                  href={hrefWith('/items', base, { page: String(result.page + 1) })}
                >
                  Next
                </Link>
              ) : null}
            </nav>
          ) : null}

          <section className="panel space-above" aria-labelledby="out-heading">
            <h2 id="out-heading">Take this list with you</h2>
            <p className="muted">Everything the filters match, not just this page.</p>
            <div className="row">
              <a className="button" href={hrefWith('/items/export', base)}>
                Download as CSV
              </a>
            </div>
            <form method="get" action="/items/labels" className="filter-bar space-above">
              {Object.entries(base).map(([k, v]) =>
                v ? <input key={k} type="hidden" name={k} value={v} /> : null,
              )}
              <div className="field">
                <label htmlFor="layout">Label sheet</label>
                <select id="layout" name="layout" className="input" defaultValue="a4-21">
                  {Object.values(LABEL_LAYOUTS).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="skip">Labels already used on the sheet</label>
                <input
                  id="skip"
                  name="skip"
                  type="number"
                  min={0}
                  max={64}
                  defaultValue={0}
                  className="input"
                />
              </div>
              <div className="field">
                <label htmlFor="company">
                  <input id="company" name="company" type="checkbox" value="1" /> Show the company
                  name
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="button">
                  Print labels (PDF)
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
