import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, MapPin, Store, Truck, Users } from 'lucide-react';
import { WHO_LABELS, whoHasWhat, whoViewFrom, type HeldItem, type WhoView } from '@northkit/core';
import { ItemStatusPill } from '@/components/badges';
import { EmptyState } from '@/components/states';
import { CardHead, Person } from '@/components/ui/primitives';
import { KindChip } from '@/components/ui/kind-icon';
import { DensityToggle } from '@/components/ui/density-toggle';
import { n, plural, ukDay } from '@/lib/format';
import { firstValues } from '@/lib/list-filters';
import { db } from '@/lib/server/db';
import { requirePermission, siteSelection } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Who has what' };

const VIEW_ICONS = { person: Users, van: Truck, site: MapPin, store: Store } as const;

/**
 * Who has what (S3-4, CO-2): kit by person, van, job site or store, each group with a
 * count, its overdue returns and a CSV of the view. "?overdue=1" shows only what is past
 * its due-back date (the Overview's Overdue returns card opens it).
 */
export default async function WhoHasWhatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission('checkouts.view');
  const params = firstValues(await searchParams);
  const view = whoViewFrom(params.view);
  const onlyOverdue = params.overdue === '1';
  const selection = await siteSelection();
  const siteIds = selection.current ? [selection.current.id] : undefined;
  const all = await whoHasWhat(db(), session.actor, view, { siteIds });
  const groups = (
    onlyOverdue
      ? all
          .map((g) => ({ ...g, items: g.items.filter((i) => i.overdue), count: g.overdue }))
          .filter((g) => g.count > 0)
      : all
  ).map((g) => g);
  const totalItems = groups.reduce((a, g) => a + g.count, 0);
  const overdue = all.reduce((a, g) => a + g.overdue, 0);
  const query = (extra: Record<string, string>) =>
    `?${new URLSearchParams({ view, ...(onlyOverdue ? { overdue: '1' } : {}), ...extra }).toString()}`;
  const exportHref = `/who-has-what/export${selection.current ? `?view=${view}&site=${selection.current.code}` : `?view=${view}`}`;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Kit</p>
          <h1>Who has what</h1>
        </div>
        <div className="page-head-actions">
          <a className="button" href={exportHref}>
            <Download size={16} className="icon" aria-hidden="true" />
            Download as CSV
          </a>
        </div>
      </div>

      <ul className="summary-strip" aria-label="Summary">
        <li>
          <span className="eyebrow">{onlyOverdue ? 'Overdue returns' : 'In this view'}</span>
          <span className="figure">
            {n(totalItems)}{' '}
            <span className="figure-unit">{totalItems === 1 ? 'item' : 'items'}</span>
          </span>
        </li>
        <li>
          <span className="eyebrow">{WHO_LABELS[view].replace('By ', '')}s</span>
          <span className="figure">{n(groups.length)}</span>
        </li>
        <li>
          <span className="eyebrow">Overdue</span>
          <span className="figure">{n(overdue)}</span>
        </li>
      </ul>

      <ul className="tabs" aria-label="Group by">
        {(Object.keys(WHO_LABELS) as WhoView[]).map((v) => {
          const Icon = VIEW_ICONS[v];
          return (
            <li key={v}>
              <Link
                className={`button${v === view ? ' button-primary' : ''}`}
                href={`?${new URLSearchParams({ view: v, ...(onlyOverdue ? { overdue: '1' } : {}) })}`}
                aria-current={v === view ? 'page' : undefined}
              >
                <Icon size={16} className="icon" aria-hidden="true" />
                {WHO_LABELS[v]}
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            className="button"
            href={onlyOverdue ? `?view=${view}` : query({ overdue: '1' })}
            aria-current={onlyOverdue ? 'true' : undefined}
          >
            {onlyOverdue ? 'Show everything' : 'Only overdue returns'}
          </Link>
        </li>
      </ul>

      {groups.length === 0 ? (
        <EmptyState
          title={onlyOverdue ? 'Nothing is overdue' : 'Nothing here yet'}
          picture="all-clear"
          action={onlyOverdue ? { href: '/who-has-what', label: 'Show everything' } : null}
        >
          <p>
            {onlyOverdue
              ? 'Every return is on time.'
              : view === 'person'
                ? 'Nobody is holding any kit. Check something out and it will appear here.'
                : 'No kit is in this kind of place yet.'}
          </p>
        </EmptyState>
      ) : (
        groups.map((g) => <GroupCard key={g.key} view={view} group={g} />)
      )}
    </>
  );
}

function GroupCard({
  view,
  group,
}: {
  view: WhoView;
  group: {
    key: string;
    label: string;
    detail: string | null;
    count: number;
    overdue: number;
    items: HeldItem[];
  };
}) {
  const id = `group-${group.key}`;
  const Icon = VIEW_ICONS[view];
  return (
    <section className="table-card group-card" id={id} aria-labelledby={`${id}-h`}>
      <div className="table-toolbar">
        <CardHead
          icon={Icon}
          headingId={`${id}-h`}
          title={view === 'person' ? <Person name={group.label} /> : group.label}
          meta={`${plural(group.count, 'item')}${group.detail ? ` · ${group.detail}` : ''}${group.overdue ? ` · ${group.overdue} overdue` : ''}`}
        />
        <span className="grow" />
        {group.overdue ? <span className="badge badge-danger">{group.overdue} overdue</span> : null}
        <DensityToggle targetId={id} />
      </div>
      <div className="table-wrap" role="region" aria-label={`Kit with ${group.label}`} tabIndex={0}>
        <table className="dt">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Out since
              </th>
              <th scope="col" className="num">
                Due back
              </th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((i) => (
              <tr key={i.id}>
                <td className="cell-first">
                  <div className="cell-identity">
                    <KindChip kindName={i.kindName} />
                    <span className="cell-text">
                      <Link className="cell-main" href={`/items/${i.id}`}>
                        {i.assetNumber}
                      </Link>
                      <span className="cell-sub">
                        {[i.kindName, i.description, i.isKit ? 'kit' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </div>
                </td>
                <td data-label="Status">
                  <ItemStatusPill status={i.status} />
                </td>
                <td data-label="Out since" className="num">
                  {i.checkedOutAt ? ukDay(i.checkedOutAt.toISOString()) : '—'}
                </td>
                <td data-label="Due back" className="num">
                  {i.dueBackOn ? ukDay(i.dueBackOn) : '—'}{' '}
                  {i.overdue ? <span className="badge badge-danger">Overdue</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
