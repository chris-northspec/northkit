-- Audit trail (S1-6): who, when, before and after for every create, change and
-- delete. Append-only, partitioned by month (DB-08). Copied from NorthKeep main
-- (commit 944121d, ADR 0002): events carry site_id, and RLS hides other sites' events.

CREATE TABLE audit.audit_events (
  id          uuid NOT NULL DEFAULT public.uuid_v7(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.users (id),
  action      text NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 100),
  entity_id   uuid,
  -- No foreign key: an audit row must outlive anything it describes.
  site_id     uuid,
  before      jsonb,
  after       jsonb,
  ip_address  inet,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_events_entity ON audit.audit_events (entity_type, entity_id, created_at);
CREATE INDEX audit_events_site ON audit.audit_events (site_id, created_at) WHERE site_id IS NOT NULL;
CREATE INDEX audit_events_actor ON audit.audit_events (created_by, created_at);

COMMENT ON TABLE audit.audit_events IS 'Append-only trail of every data change and security event: who did what to which record, with before and after values. Partitioned by month on created_at. Secrets are never recorded.';
COMMENT ON COLUMN audit.audit_events.id IS 'Event id, a UUIDv7. With created_at forms the primary key (partitioned tables need the partition key in it).';
COMMENT ON COLUMN audit.audit_events.created_at IS 'When it happened (UTC); also the partition key.';
COMMENT ON COLUMN audit.audit_events.created_by IS 'User who did it; null for system jobs and failed sign-ins for unknown accounts.';
COMMENT ON COLUMN audit.audit_events.action IS 'What happened, dotted lower case: <schema>.<table>.<create|update|archive|restore|delete> for data changes, auth.<event> for sign-in events, licence.<event> for licence events.';
COMMENT ON COLUMN audit.audit_events.entity_type IS 'Kind of record affected, e.g. core.users or core.locations.';
COMMENT ON COLUMN audit.audit_events.entity_id IS 'Id of the record affected, where there is one.';
COMMENT ON COLUMN audit.audit_events.site_id IS 'Site the record belongs to; null for organisation-level events (users, roles, sign-ins). Row-level security hides other sites'' events.';
COMMENT ON COLUMN audit.audit_events.before IS '[personal] Record before the change (JSON), without secrets. Null for creates and sign-in events.';
COMMENT ON COLUMN audit.audit_events.after IS '[personal] Record after the change (JSON), without secrets, or event details. Null for deletes.';
COMMENT ON COLUMN audit.audit_events.ip_address IS '[personal] IP address of the request, for sign-in events.';

-- Organisation-level events (site_id null) are visible to anyone with users.view, which
-- the app checks; site events only within the site scope.
CREATE FUNCTION audit.apply_audit_policies(target regclass) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format(
    'CREATE POLICY site_isolation ON %s TO northkit_app USING (site_id IS NULL OR site_id = ANY (public.current_site_ids())) WITH CHECK (site_id IS NULL OR site_id = ANY (public.current_site_ids()))',
    target);
  EXECUTE format('CREATE POLICY owner_access ON %s TO northkit_owner USING (true) WITH CHECK (true)', target);
  EXECUTE format('CREATE POLICY reporting_read ON %s FOR SELECT TO northkit_readonly USING (true)', target);
END
$$;
COMMENT ON FUNCTION audit.apply_audit_policies(regclass) IS 'RLS for audit_events and each partition: organisation events visible to all, site events only within scope; the reporting role reads every event.';
REVOKE EXECUTE ON FUNCTION audit.apply_audit_policies(regclass) FROM PUBLIC;

SELECT audit.apply_audit_policies('audit.audit_events');

-- Append-only, for the app and the owner alike.
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM northkit_app;
CREATE FUNCTION audit.refuse_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;
COMMENT ON FUNCTION audit.refuse_change() IS 'Trigger that blocks UPDATE and DELETE on audit events. Old months are removed only by dropping a partition under the retention policy.';
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit.audit_events
  FOR EACH ROW EXECUTE FUNCTION audit.refuse_change();

-- Creates the partition for the current month and the next `months_ahead` months.
-- The worker runs it daily, so inserts never meet a missing month. Partitions are
-- reached only through the parent: the app gets no direct grants on them, and each
-- carries the same policies in case it ever does.
CREATE FUNCTION audit.ensure_partitions(months_ahead integer DEFAULT 3) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  part_start date;
  part_name text;
  created integer := 0;
BEGIN
  IF months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
  END IF;
  FOR i IN 0..months_ahead LOOP
    part_start := (month_start + make_interval(months => i))::date;
    part_name := format('audit_events_y%sm%s', to_char(part_start, 'YYYY'), to_char(part_start, 'MM'));
    CONTINUE WHEN to_regclass(format('audit.%I', part_name)) IS NOT NULL;
    EXECUTE format(
      'CREATE TABLE audit.%I PARTITION OF audit.audit_events FOR VALUES FROM (%L) TO (%L)',
      part_name,
      (part_start::timestamp AT TIME ZONE 'UTC'),
      ((part_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
    EXECUTE format('REVOKE ALL ON audit.%I FROM northkit_app, northkit_readonly', part_name);
    PERFORM audit.apply_audit_policies(format('audit.%I', part_name)::regclass);
    EXECUTE format('COMMENT ON TABLE audit.%I IS %L', part_name,
      format('Audit events for %s (partition of audit.audit_events).', to_char(part_start, 'FMMonth YYYY')));
    created := created + 1;
  END LOOP;
  RETURN created;
END
$$;
ALTER FUNCTION audit.ensure_partitions(integer) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION audit.ensure_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer) TO northkit_app;
COMMENT ON FUNCTION audit.ensure_partitions(integer) IS 'Creates missing monthly audit partitions from this month to months_ahead months ahead; returns how many it made. Run daily by the worker.';

SELECT audit.ensure_partitions(3);

-- Data-change auditing. Columns listed in `ignored` are bookkeeping: a change to
-- only those (a failed sign-in count, the last-login time) is not a data change and
-- is covered by the auth.* events instead.
CREATE FUNCTION audit.record_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  secrets text[] := ARRAY['password_hash', 'mfa_secret_encrypted', 'token_hash'];
  ignored text[] := ARRAY['updated_at', 'updated_by', 'row_version', 'failed_login_count', 'locked_until',
                          'last_login_at', 'mfa_last_used_step'];
  old_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  subject jsonb := coalesce(new_row, old_row);
  verb text;
  event_site uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (old_row - secrets - ignored) = (new_row - secrets - ignored)
       AND (old_row -> 'password_hash') IS NOT DISTINCT FROM (new_row -> 'password_hash')
       AND (old_row -> 'mfa_secret_encrypted') IS NOT DISTINCT FROM (new_row -> 'mfa_secret_encrypted') THEN
      RETURN NULL;
    END IF;
    verb := CASE
      WHEN old_row ->> 'archived_at' IS NULL AND new_row ->> 'archived_at' IS NOT NULL THEN 'archive'
      WHEN old_row ->> 'archived_at' IS NOT NULL AND new_row ->> 'archived_at' IS NULL THEN 'restore'
      ELSE 'update' END;
  ELSE
    verb := CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'delete' END;
  END IF;

  event_site := CASE
    WHEN TG_TABLE_SCHEMA = 'core' AND TG_TABLE_NAME = 'sites' THEN (subject ->> 'id')::uuid
    ELSE (subject ->> 'site_id')::uuid END;

  -- Record that a secret changed, never its value.
  IF TG_OP = 'UPDATE' THEN
    IF (old_row -> 'password_hash') IS DISTINCT FROM (new_row -> 'password_hash') THEN
      new_row := new_row || '{"password_changed": true}';
    END IF;
    IF (old_row -> 'mfa_secret_encrypted') IS DISTINCT FROM (new_row -> 'mfa_secret_encrypted') THEN
      new_row := new_row || '{"mfa_secret_changed": true}';
    END IF;
  END IF;

  INSERT INTO audit.audit_events (created_by, action, entity_type, entity_id, site_id, before, after)
  VALUES (public.current_user_id(),
          format('%s.%s.%s', TG_TABLE_SCHEMA, TG_TABLE_NAME, verb),
          format('%s.%s', TG_TABLE_SCHEMA, TG_TABLE_NAME),
          (subject ->> 'id')::uuid,
          event_site,
          old_row - secrets,
          new_row - secrets);
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION audit.record_change() IS 'AFTER INSERT/UPDATE/DELETE trigger writing one audit event per changed row, without secrets. Updates touching only bookkeeping columns are skipped.';

-- Every table that holds data people change. Sessions are covered by auth.* events.
-- New tables add theirs with audit.track(); the audit coverage test fails otherwise.
CREATE FUNCTION audit.track(target regclass) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.record_change()',
    target);
END
$$;
COMMENT ON FUNCTION audit.track(regclass) IS 'Adds the audit_changes trigger to a table. Call once after CREATE TABLE for every table except sessions and the audit log itself.';
REVOKE EXECUTE ON FUNCTION audit.track(regclass) FROM PUBLIC;

SELECT audit.track(t::regclass) FROM unnest(ARRAY[
  'core.users', 'core.organisations', 'core.sites', 'core.locations', 'core.settings', 'core.roles',
  'core.user_roles', 'core.user_sites', 'core.role_sites']) AS t;
