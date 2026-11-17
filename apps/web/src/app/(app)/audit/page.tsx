import type { Metadata } from 'next';
import { listAuditEntityTypes, listAuditEvents, listSites } from '@northkit/core';
import { EmptyState } from '@/components/states';
import { firstValues, hrefWith } from '@/lib/list-filters';
import { auditChanges, auditQueryFrom } from '@/lib/server/audit-filters';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Audit log' };

const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Europe/London',
});

const SHOWN = 500;

/** X-4, S1-6, S7-7: who, when, before and after, newest first, with filters and a CSV. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission('users.view');
  const params = firstValues(await searchParams);
  const query = auditQueryFrom(params);
  const [events, users, types, sites] = await Promise.all([
    listAuditEvents(db(), session.actor, { ...query, limit: SHOWN + 1 }),
    db().selectFrom('core.users').select(['id', 'display_name']).orderBy('display_name').execute(),
    listAuditEntityTypes(db(), session.actor),
    listSites(db(), session.actor, { includeArchived: true }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.display_name]));
  const shown = events.slice(0, SHOWN);
  const kept = {
    type: query.entityType,
    user: query.userId,
    site: query.siteId,
    from: query.from,
    to: query.to,
    entity: query.entityId,
  };

  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">
        Every create, change and delete, and every sign-in event, at your sites. Entries can’t be
        changed or removed.
      </p>
      <form className="filters" method="get" action="/audit">
        {query.entityId ? <input type="hidden" name="entity" value={query.entityId} /> : null}
        <div className="field">
          <label htmlFor="user">Person</label>
          <select id="user" name="user" defaultValue={query.userId ?? ''}>
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="type">Record type</label>
          <select id="type" name="type" defaultValue={query.entityType ?? ''}>
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-site">Site</label>
          <select id="audit-site" name="site" defaultValue={query.siteId ?? ''}>
            <option value="">Any (and organisation events)</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={query.from ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={query.to ?? ''} />
        </div>
        <div className="form-actions">
          <button className="button" type="submit">
            Filter
          </button>
        </div>
      </form>
      <p className="list-count" role="status">
        {events.length > SHOWN
          ? `The newest ${SHOWN.toLocaleString('en-GB')} entries`
          : `${shown.length.toLocaleString('en-GB')} ${shown.length === 1 ? 'entry' : 'entries'}`}{' '}
        ·{' '}
        <a href={hrefWith('/audit/export', kept)} download>
          Download as CSV
        </a>
        {events.length > SHOWN ? ' (every matching entry, up to 50,000)' : null}
      </p>
      {shown.length === 0 ? (
        <EmptyState title="Nothing recorded for these filters" />
      ) : (
        <div className="table-wrap" role="region" aria-label="Audit events" tabIndex={0}>
          <table className="table table-cards">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{ukDateTime.format(e.created_at)}</td>
                  <td data-label="Who">
                    {e.created_by ? (names.get(e.created_by) ?? 'Unknown user') : 'System'}
                  </td>
                  <td data-label="What" className="mono small">
                    {e.action}
                  </td>
                  <td data-label="Change" className="small">
                    {auditChanges(e) || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
