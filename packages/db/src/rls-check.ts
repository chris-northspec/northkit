import type pg from 'pg';

export interface RlsProblem {
  table: string;
  problems: string[];
}

// Tables whose site key is not called site_id. core.sites is the site itself.
export const SITE_ROOTS: Record<string, string> = { 'core.sites': 'id' };

/**
 * Lists site-owned tables that are not protected (DB-06): any table or partition
 * with a site_id column (or a site root) must have RLS enabled and forced, a
 * site_isolation policy for northkit_app that uses public.current_site_ids(), and a
 * SELECT-only reporting_read policy for northkit_readonly. Also fails if any product
 * role could bypass RLS.
 */
export async function findRlsProblems(client: pg.Pool | pg.ClientBase): Promise<RlsProblem[]> {
  const { rows } = await client.query<{
    table_name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_ok: boolean;
    reporting_ok: boolean;
    extra_policies: string[];
  }>(
    `
    SELECT format('%s.%s', n.nspname, c.relname) AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           EXISTS (
             SELECT FROM pg_policy p
              WHERE p.polrelid = c.oid
                AND p.polname = 'site_isolation'
                AND p.polroles = ARRAY['northkit_app'::regrole::oid]
                AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_site_ids()%'
                AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%current_site_ids()%'
           ) AS policy_ok,
           EXISTS (
             SELECT FROM pg_policy p
              WHERE p.polrelid = c.oid
                AND p.polname = 'reporting_read'
                AND p.polcmd = 'r'
                AND p.polroles = ARRAY['northkit_readonly'::regrole::oid]
           ) AS reporting_ok,
           -- Any other policy could widen access; only the owner's is expected.
           ARRAY(SELECT p.polname::text FROM pg_policy p
                  WHERE p.polrelid = c.oid
                    AND p.polname NOT IN ('site_isolation', 'reporting_read', 'owner_access')
                  ORDER BY 1) AS extra_policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
       AND n.nspname NOT LIKE 'pg_temp%'
       AND (EXISTS (SELECT FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'site_id' AND NOT a.attisdropped)
            OR format('%s.%s', n.nspname, c.relname) = ANY ($1))
     ORDER BY 1`,
    [Object.keys(SITE_ROOTS)],
  );

  const problems: RlsProblem[] = [];
  for (const row of rows) {
    const found: string[] = [];
    if (!row.rls_enabled) found.push('row-level security is not enabled');
    if (!row.rls_forced) found.push('row-level security is not forced');
    if (!row.policy_ok)
      found.push('no site_isolation policy for northkit_app on public.current_site_ids()');
    if (!row.reporting_ok) found.push('no SELECT-only reporting_read policy for northkit_readonly');
    if (row.extra_policies.length)
      found.push(`unexpected policies: ${row.extra_policies.join(', ')}`);
    if (found.length > 0) problems.push({ table: row.table_name, problems: found });
  }

  const roles = await client.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles
      WHERE starts_with(rolname, 'northkit_') AND (rolbypassrls OR rolsuper)`,
  );
  for (const role of roles.rows) {
    problems.push({ table: `role ${role.rolname}`, problems: ['can bypass row-level security'] });
  }
  return problems;
}

/** Every site-owned table (and partition) the check covers, for the isolation tests. */
export async function siteOwnedTables(client: pg.Pool | pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT format('%s.%s', n.nspname, c.relname) AS table_name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'pgboss')
        AND (EXISTS (SELECT FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'site_id' AND NOT a.attisdropped)
             OR format('%s.%s', n.nspname, c.relname) = ANY ($1))
      ORDER BY 1`,
    [Object.keys(SITE_ROOTS)],
  );
  return rows.map((r) => r.table_name);
}
