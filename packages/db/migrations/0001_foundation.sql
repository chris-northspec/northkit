-- northkit:run-as-admin
-- Foundation: extensions, roles, module schemas and the helpers every table uses.
-- Runs as the superuser because it creates extensions and roles.
-- Copied from NorthKeep main (commit 944121d, see ADR 0002) and adapted: the isolation
-- key is site_id, a depot or branch (docs/03-database-requirements.md, DB-06).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS ltree;

-- Roles are cluster-wide, so they may already exist (another database, a re-install).
-- Their safety attributes are reasserted either way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_owner') THEN
    CREATE ROLE northkit_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_app') THEN
    CREATE ROLE northkit_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'northkit_readonly') THEN
    CREATE ROLE northkit_readonly NOLOGIN;
  END IF;
END
$$;

ALTER ROLE northkit_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOLOGIN;
ALTER ROLE northkit_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
ALTER ROLE northkit_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

COMMENT ON ROLE northkit_owner IS 'Owns every NorthKit schema and table. Migrations run as this role. Never used by the running app.';
COMMENT ON ROLE northkit_app IS 'The web app and worker connect as this role. Subject to row-level security on app.site_ids; never BYPASSRLS.';
COMMENT ON ROLE northkit_readonly IS 'Organisation-wide read-only reporting role (Power BI, Excel): reads every site through the reporting_read policy, writes nothing. Give it only to the operator''s own staff.';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE ON DATABASE %I TO northkit_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO northkit_app, northkit_readonly', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON public.schema_migrations FROM PUBLIC;
-- northkit_owner creates the shared helper functions in public.
GRANT CREATE ON SCHEMA public TO northkit_owner;

-- One schema per module (DB-02).
-- Later sprints add their own schemas (register, movements, inspections) in the
-- migration that first needs them.
CREATE SCHEMA core AUTHORIZATION northkit_owner;
CREATE SCHEMA audit AUTHORIZATION northkit_owner;
CREATE SCHEMA reporting AUTHORIZATION northkit_owner;
-- pg-boss creates and maintains its own job tables here when the worker starts.
CREATE SCHEMA pgboss AUTHORIZATION northkit_app;

COMMENT ON SCHEMA core IS 'The organisation, sites, locations, users, roles, sessions, settings and the licence.';
COMMENT ON SCHEMA audit IS 'Append-only audit trail of every create, change and delete, partitioned by month (DB-08).';
COMMENT ON SCHEMA reporting IS 'Documented read-only views for Power BI and Excel (DB-10).';
COMMENT ON SCHEMA pgboss IS 'Job queue tables owned and managed by pg-boss in the worker. Not part of the NorthKit data model.';

GRANT USAGE ON SCHEMA core, audit, reporting TO northkit_app;
-- The reporting login reads the documented views in `reporting` and nothing else: it
-- gets no access to the tables, so the views (which show every site) are its only way in.
-- The reporting_read policies stay on every site-owned table: harmless without table
-- access, and the RLS gate expects them.
GRANT USAGE ON SCHEMA reporting TO northkit_readonly;

-- New tables are readable and writable by the app; reporting views are readable by reporting. No DELETE by
-- default: master data is archived and evidence is corrected by new rows (DB-04).
-- Tables that genuinely need DELETE grant it explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner
  IN SCHEMA core, audit, reporting
  GRANT SELECT, INSERT, UPDATE ON TABLES TO northkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner
  IN SCHEMA reporting
  GRANT SELECT ON TABLES TO northkit_readonly;
-- The app never reads the views: they would step round its row-level security.
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner
  IN SCHEMA reporting
  REVOKE SELECT, INSERT, UPDATE ON TABLES FROM northkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner
  IN SCHEMA core, audit, reporting
  GRANT USAGE, SELECT ON SEQUENCES TO northkit_app;

-- UUIDv7 (RFC 9562): a 48-bit millisecond timestamp, then random bits. Ids sort by
-- creation time, which keeps B-tree inserts at the right-hand edge of the index.
CREATE FUNCTION public.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;
COMMENT ON FUNCTION public.uuid_v7() IS 'Returns a new time-ordered UUID (version 7). Default for every id column (DB-03).';

-- The site ids the current transaction may see, from app.site_ids. Unset or blank
-- means none, so a query run without a scope returns nothing rather than everything.
CREATE FUNCTION public.current_site_ids() RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(nullif(current_setting('app.site_ids', true), '')::uuid[], '{}'::uuid[]);
$$;
COMMENT ON FUNCTION public.current_site_ids() IS 'Site ids visible to this transaction, from the app.site_ids setting. Empty when unset (fail closed). Used by every site_isolation policy.';

-- The signed-in user for created_by / updated_by and the audit trail, from app.user_id.
CREATE FUNCTION public.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;
COMMENT ON FUNCTION public.current_user_id() IS 'User acting in this transaction, from the app.user_id setting; null for system jobs.';

-- Standard columns (DB-04). Callers can't forge them: created_* is fixed at insert,
-- updated_* and row_version are always set here. Office edits use row_version for
-- optimistic locking: UPDATE ... WHERE id = $1 AND row_version = $2.
CREATE FUNCTION public.maintain_standard_columns() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.created_by := coalesce(NEW.created_by, public.current_user_id());
    NEW.updated_at := NEW.created_at;
    NEW.updated_by := NEW.created_by;
    NEW.row_version := 1;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := public.current_user_id();
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION public.maintain_standard_columns() IS 'BEFORE INSERT OR UPDATE trigger: fills created_at/by, updated_at/by and increments row_version.';

-- Standard columns: the trigger plus the same comment on every table, so each table's
-- own comments only cover what is specific to it.
CREATE FUNCTION public.apply_standard_columns(target regclass) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER maintain_standard_columns BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.maintain_standard_columns()',
    target);
  EXECUTE format('COMMENT ON COLUMN %s.id IS %L', target, 'Primary key, a UUIDv7 (time-ordered).');
  EXECUTE format('COMMENT ON COLUMN %s.created_at IS %L', target, 'When the row was created (UTC). Set by trigger.');
  EXECUTE format('COMMENT ON COLUMN %s.created_by IS %L', target, 'User who created the row; null for system jobs and migrations. Set by trigger.');
  EXECUTE format('COMMENT ON COLUMN %s.updated_at IS %L', target, 'When the row last changed (UTC). Set by trigger.');
  EXECUTE format('COMMENT ON COLUMN %s.updated_by IS %L', target, 'User who last changed the row; null for system jobs. Set by trigger.');
  EXECUTE format('COMMENT ON COLUMN %s.row_version IS %L', target, 'Starts at 1 and goes up by one on every update. Office edits send it back for optimistic locking.');
  IF EXISTS (SELECT FROM pg_attribute WHERE attrelid = target AND attname = 'archived_at' AND NOT attisdropped) THEN
    EXECUTE format('COMMENT ON COLUMN %s.archived_at IS %L', target, 'When the row was archived (UTC). Master data is archived, never deleted (DB-04). Null means current.');
  END IF;
  IF EXISTS (SELECT FROM pg_attribute WHERE attrelid = target AND attname = 'site_id' AND NOT attisdropped) THEN
    EXECUTE format('COMMENT ON COLUMN %s.site_id IS %L', target, 'Site the row belongs to (row-level security key, DB-06).');
  END IF;
END
$$;
COMMENT ON FUNCTION public.apply_standard_columns(regclass) IS 'Adds the standard-columns trigger to a table and comments its standard columns. Call once after CREATE TABLE.';

-- Policy template (DB-06). Every site-owned table calls this once in the migration
-- that creates it; pnpm db:check-rls fails the build if one doesn't.
--   site_isolation: the app sees and writes only rows for sites in app.site_ids.
--   owner_access:   FORCE ROW LEVEL SECURITY applies policies to the table owner too, so
--                   the owner (migrations, owner-defined SECURITY DEFINER helpers) gets
--                   an explicit unrestricted policy. The app is not a member of it.
--   reporting_read: the organisation-wide reporting role reads every site; it has no write grants.
CREATE FUNCTION public.enable_site_isolation(target regclass, site_column name DEFAULT 'site_id')
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY site_isolation ON %s TO northkit_app USING (%I = ANY (public.current_site_ids())) WITH CHECK (%I = ANY (public.current_site_ids()))',
    target, site_column, site_column);
  EXECUTE format('CREATE POLICY owner_access ON %s TO northkit_owner USING (true) WITH CHECK (true)', target);
  EXECUTE format('CREATE POLICY reporting_read ON %s FOR SELECT TO northkit_readonly USING (true)', target);
END
$$;
COMMENT ON FUNCTION public.enable_site_isolation(regclass, name) IS 'Policy template: enables and forces RLS on a site-owned table and adds site_isolation (app, on app.site_ids), owner_access (owner) and reporting_read (readonly, SELECT only).';

ALTER FUNCTION public.uuid_v7() OWNER TO northkit_owner;
ALTER FUNCTION public.current_site_ids() OWNER TO northkit_owner;
ALTER FUNCTION public.current_user_id() OWNER TO northkit_owner;
ALTER FUNCTION public.maintain_standard_columns() OWNER TO northkit_owner;
ALTER FUNCTION public.apply_standard_columns(regclass) OWNER TO northkit_owner;
ALTER FUNCTION public.enable_site_isolation(regclass, name) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION public.apply_standard_columns(regclass) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enable_site_isolation(regclass, name) FROM PUBLIC;
