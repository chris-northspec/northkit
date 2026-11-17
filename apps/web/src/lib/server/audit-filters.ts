import 'server-only';
import type { AuditQuery } from '@northkit/core';
import { isUuid, type AuditEvent } from '@northkit/db';
import type { Params } from '@/lib/list-filters';

// The audit log's filters (X-4, S7-7), read from the address the same way by the screen
// and its CSV export, so the download is exactly what the screen shows (without its limit).

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENTITY = /^[a-z_]+\.[a-z_]+$/;

export function auditQueryFrom(params: Params): AuditQuery {
  const q: AuditQuery = {};
  if (params.entity && isUuid(params.entity)) q.entityId = params.entity;
  if (params.type && ENTITY.test(params.type)) q.entityType = params.type;
  if (params.user && isUuid(params.user)) q.userId = params.user;
  if (params.site && isUuid(params.site)) q.siteId = params.site;
  if (params.from && ISO_DAY.test(params.from)) q.from = params.from;
  if (params.to && ISO_DAY.test(params.to)) q.to = params.to;
  return q;
}

/** Fields that changed between before and after, without bookkeeping columns. */
export function auditChanges(event: Pick<AuditEvent, 'before' | 'after'>, max = 6): string {
  const skip = new Set([
    'updated_at',
    'updated_by',
    'row_version',
    'created_at',
    'created_by',
    'id',
  ]);
  const b = (event.before ?? {}) as Record<string, unknown>;
  const a = (event.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !skip.has(k));
  const changed = keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  return changed
    .slice(0, max)
    .map((k) =>
      event.before && event.after
        ? `${k}: ${JSON.stringify(b[k]) ?? '—'} → ${JSON.stringify(a[k]) ?? '—'}`
        : `${k}: ${JSON.stringify(a[k] ?? b[k])}`,
    )
    .join('; ');
}
