import { AUDIT_EXPORT_LIMIT, can, listAuditEvents, toReportCsv } from '@northkit/core';
import { firstValues } from '@/lib/list-filters';
import { auditChanges, auditQueryFrom } from '@/lib/server/audit-filters';
import { db } from '@/lib/server/db';
import { currentSession } from '@/lib/server/session';

/**
 * The audit log as CSV (X-4, S7-7), with the screen's filters: who, when (UTC and UK
 * time), what, the record, the site, the address, and the full before and after.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session || !can(session.actor, 'users.view'))
    return new Response('Not found', { status: 404 });
  const params = firstValues(Object.fromEntries(new URL(request.url).searchParams));
  const query = auditQueryFrom(params);
  const [events, users] = await Promise.all([
    listAuditEvents(db(), session.actor, { ...query, limit: AUDIT_EXPORT_LIMIT }),
    db().selectFrom('core.users').select(['id', 'display_name', 'email']).execute(),
  ]);
  const people = new Map(users.map((u) => [u.id, u]));
  const uk = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/London',
  });
  const csv = toReportCsv([
    ['when_utc', 'when_uk', 'who', 'who_email', 'action', 'record_type', 'record_id', 'site_id', 'ip_address', 'changes', 'before', 'after'],
    ...events.map((e) => {
      const who = e.created_by ? people.get(e.created_by) : undefined;
      return [
        e.created_at.toISOString(),
        uk.format(e.created_at),
        e.created_by ? (who?.display_name ?? 'Unknown user') : 'System',
        who?.email ?? '',
        e.action,
        e.entity_type,
        e.entity_id ?? '',
        e.site_id ?? '',
        e.ip_address ?? '',
        auditChanges(e, 50),
        e.before ? JSON.stringify(e.before) : '',
        e.after ? JSON.stringify(e.after) : '',
      ];
    }),
  ]); // prettier-ignore
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="northkit-audit-log-${day}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
