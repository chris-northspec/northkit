import { sql, withScope, type AuditEvent, type Db, type Tx } from '@northkit/db';
import { requirePermission, scopeOf, type ActorContext } from './context';

export type AuthAction =
  | 'auth.sign_in'
  | 'auth.sign_in_failed'
  | 'auth.sign_in_refused_locked'
  | 'auth.account_locked'
  | 'auth.mfa_failed'
  | 'auth.sign_out'
  | 'auth.password_changed'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.mfa_reset'
  | 'auth.first_run_setup'
  | 'auth.setup_code_failed';

/**
 * Writes a security event. Data changes are audited by database triggers (X-4); these
 * are the sign-in events that don't change a business record. Never pass secrets or
 * the email that was typed (people sometimes type their password into it).
 */
export async function recordAuthEvent(
  tx: Tx,
  event: {
    action: AuthAction;
    userId: string | null;
    ipAddress?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx
    .insertInto('audit.audit_events')
    .values({
      created_by: event.userId,
      action: event.action,
      entity_type: 'core.users',
      entity_id: event.userId,
      site_id: null,
      after: event.details ? JSON.stringify(event.details) : null,
      ip_address: event.ipAddress ?? null,
    })
    .execute();
}

/**
 * Logs a no-login report attempt (RP-4), accepted or refused, with the poster's location
 * and the caller's IP. These rows are also what the rate limits count.
 */
export async function recordPublicEvent(
  db: Db,
  event: {
    action:
      | 'public.report.accepted'
      | 'public.report.refused'
      | `public.contractor_link.${'opened' | 'accepted' | 'updated' | 'photos' | 'completed' | 'refused'}`;
    siteId: string | null;
    /** The poster's location, or the label's asset when entityType says so. */
    locationId: string | null;
    entityType?: 'core.locations' | 'assets.assets' | 'contractors.job_links';
    ipAddress: string | null;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await withScope(db, { siteIds: event.siteId ? [event.siteId] : [] }, (tx) =>
    tx
      .insertInto('audit.audit_events')
      .values({
        created_by: null,
        action: event.action,
        entity_type: event.entityType ?? 'core.locations',
        entity_id: event.locationId,
        site_id: event.siteId,
        after: JSON.stringify(event.details),
        ip_address: event.ipAddress,
      })
      .execute(),
  );
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  siteId?: string;
  /** Who made the change (created_by). */
  userId?: string;
  /** Days, yyyy-mm-dd, inclusive, as dates in the UK (Europe/London). */
  from?: string;
  to?: string;
  limit?: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The most rows the CSV export takes at once (the screen shows at most 500). */
export const AUDIT_EXPORT_LIMIT = 50_000;

/**
 * Audit events the actor may see, newest first: organisation events plus their sites'
 * (RLS). Filters by record type, record, site, person and UK dates (X-4).
 */
export async function listAuditEvents(
  db: Db,
  actor: ActorContext,
  query: AuditQuery = {},
): Promise<AuditEvent[]> {
  requirePermission(actor, 'users.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) => {
    let q = tx
      .selectFrom('audit.audit_events')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.min(query.limit ?? 100, AUDIT_EXPORT_LIMIT));
    if (query.entityType) q = q.where('entity_type', '=', query.entityType);
    if (query.entityId) q = q.where('entity_id', '=', query.entityId);
    if (query.siteId) q = q.where('site_id', '=', query.siteId);
    if (query.userId) q = q.where('created_by', '=', query.userId);
    if (query.from && ISO_DAY.test(query.from))
      q = q.where(
        'created_at',
        '>=',
        sql<Date>`(${query.from}::date)::timestamp AT TIME ZONE 'Europe/London'`,
      );
    if (query.to && ISO_DAY.test(query.to))
      q = q.where(
        'created_at',
        '<',
        sql<Date>`(${query.to}::date + 1)::timestamp AT TIME ZONE 'Europe/London'`,
      );
    return q.execute();
  });
}

/** The record types in the log the actor can see, for the filter. */
export async function listAuditEntityTypes(db: Db, actor: ActorContext): Promise<string[]> {
  requirePermission(actor, 'users.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const rows = await tx
      .selectFrom('audit.audit_events')
      .select('entity_type')
      .distinct()
      .orderBy('entity_type')
      .execute();
    return rows.map((r) => r.entity_type);
  });
}
