import { DB_ROLES, sql, withScope, type Db } from '@northkit/db';
import { requirePermission, scopeOf, type ActorContext } from '../context';

// The reporting login (S7-3, DR-4): northkit_readonly, for Power BI or Excel. It reads
// the documented views in the `reporting` schema only (migration 0018). Its password is
// NORTHKIT_READONLY_DB_PASSWORD in deploy/.env, applied by the migrate step; blank turns
// the login off. The web app never sees or sets it (secrets from the environment only).

export interface ReportingView {
  name: string;
  description: string;
}

export interface ReportingLogin {
  role: string;
  /** Whether the role can sign in (a password is set). */
  enabled: boolean;
  views: ReportingView[];
}

export async function reportingLogin(db: Db, actor: ActorContext): Promise<ReportingLogin> {
  requirePermission(actor, 'settings.view');
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    // The catalogue is readable by every role; the views themselves aren't, to the app.
    const [role, views] = await Promise.all([
      sql<{ enabled: boolean }>`SELECT rolcanlogin AS enabled FROM pg_roles
                                 WHERE rolname = ${DB_ROLES.readonly}`.execute(tx),
      sql<ReportingView>`SELECT c.relname AS name, coalesce(obj_description(c.oid, 'pg_class'), '') AS description
                           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'reporting' AND c.relkind = 'v'
                          ORDER BY c.relname`.execute(tx),
    ]);
    return {
      role: DB_ROLES.readonly,
      enabled: role.rows[0]?.enabled ?? false,
      views: views.rows,
    };
  });
}
