import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Eye, LogIn, LogOut, Printer, Search } from 'lucide-react';
import {
  can,
  ITEM_STATUSES,
  itemStatusCounts,
  listItems,
  listKinds,
  siteChoices,
  STATUS_LABELS,
} from '@northkit/core';
import { FilterChips } from '@/components/filter-chips';
import { ItemStatusPill } from '@/components/badges';
import { EmptyState, orDash } from '@/components/states';
import { CardHead, Person, RowMenu } from '@/components/ui/primitives';
import { DensityToggle } from '@/components/ui/density-toggle';
import { KindChip } from '@/components/ui/kind-icon';
import { n, ukDay } from '@/lib/format';
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
  const [result, counts, kinds, depots] = await Promise.all([
    listItems(db(), session.actor, filters),
    itemStatusCounts(db(), session.actor, filters),
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
  const canMove = can(session.actor, 'checkouts.create');

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Register</p>
          <h1>Items</h1>
        </div>
        <div className="page-head-actions sticky-bottom">
          {canAdd ? (
            <Link className="button button-primary" href="/items/new">
              Add an item
            </Link>
          ) : null}
        </div>
      </div>

      <ul className="summary-strip" aria-label="Summary of the items in this list">
        <li>
          <span className="eyebrow">In this list</span>
          <span className="figure">
            {n(counts.total)}{' '}
            <span className="figure-unit">{counts.total === 1 ? 'item' : 'items'}</span>
          </span>
        </li>
        <li>
          <span className="eyebrow">Available</span>
          <span className="figure">{n(counts.byStatus.available)}</span>
        </li>
        <li>
          <span className="eyebrow">Out</span>
          <span className="figure">
            {n(counts.byStatus.out)}
            {counts.overdue > 0 ? (
              <span className="figure-unit"> · {n(counts.overdue)} overdue</span>
            ) : null}
          </span>
        </li>
        <li>
          <span className="eyebrow">Missing or in transit</span>
          <span className="figure">{n(counts.byStatus.missing + counts.byStatus.in_transit)}</span>
        </li>
      </ul>

      <div className="card">
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
              <Search size={16} className="icon" aria-hidden="true" />
              Filter
            </button>
          </div>
        </form>
      </div>

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
          <section className="table-card" id="items-card" aria-label="Items">
            <div className="table-toolbar">
              <p className="list-count grow" role="status">
                {count}
              </p>
              <DensityToggle targetId="items-card" />
            </div>
            <div className="table-wrap" role="region" aria-label="Items" tabIndex={0}>
              <table className="dt">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Where it is</th>
                    <th scope="col">Depot</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Due back
                    </th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-first">
                        <div className="cell-identity">
                          {r.photoId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="item-thumb"
                              src={`/item-photos/${r.photoId}?v=thumb`}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                            />
                          ) : (
                            <KindChip kindName={r.kindName} />
                          )}
                          <span className="cell-text">
                            <Link className="cell-main" href={`/items/${r.id}`}>
                              {r.assetNumber}
                            </Link>
                            <span className="cell-sub">
                              {[
                                r.kindName,
                                [r.make, r.model].filter(Boolean).join(' ') || r.description,
                                r.isKit ? `kit of ${r.partCount}` : null,
                                r.kitAssetNumber ? `in ${r.kitAssetNumber}` : null,
                                r.ownership === 'hired_in' ? 'hired in' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td data-label="Where it is">
                        {r.holderName ? <Person name={r.holderName} /> : orDash(r.locationName)}
                      </td>
                      <td data-label="Depot">{r.siteCode}</td>
                      <td data-label="Status">
                        <ItemStatusPill status={r.status} />
                      </td>
                      <td data-label="Due back" className="num">
                        {r.status === 'out' && r.dueBackOn ? (
                          <>
                            {ukDay(r.dueBackOn)}{' '}
                            {r.overdue ? <span className="badge badge-danger">Overdue</span> : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          <Link className="button" href={`/items/${r.id}`}>
                            <Eye size={16} className="icon" aria-hidden="true" />
                            View
                          </Link>
                          {canMove && r.status === 'available' ? (
                            <Link className="button" href={`/move/out?item=${r.id}`}>
                              <LogOut size={16} className="icon" aria-hidden="true" />
                              Check out
                            </Link>
                          ) : null}
                        </div>
                        <RowMenu label={`More actions for ${r.assetNumber}`}>
                          <Link href={`/items/${r.id}`}>
                            <Eye size={16} className="icon" aria-hidden="true" />
                            View the item
                          </Link>
                          {canMove && r.status === 'available' ? (
                            <Link href={`/move/out?item=${r.id}`}>
                              <LogOut size={16} className="icon" aria-hidden="true" />
                              Check out
                            </Link>
                          ) : null}
                          {canMove && r.status === 'out' ? (
                            <Link href={`/move/in?item=${r.id}`}>
                              <LogIn size={16} className="icon" aria-hidden="true" />
                              Check in
                            </Link>
                          ) : null}
                        </RowMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

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

          <section className="card space-above" aria-labelledby="out-heading">
            <CardHead
              icon={Download}
              headingId="out-heading"
              title="Take this list with you"
              meta="Everything the filters match, not just this page."
            />
            <div className="row">
              <a className="button" href={hrefWith('/items/export', base)}>
                <Download size={16} className="icon" aria-hidden="true" />
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
                  <Printer size={16} className="icon" aria-hidden="true" />
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
