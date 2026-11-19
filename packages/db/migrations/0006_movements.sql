-- Sprint 3: where kit is and who has it. Schema `movements` (DB-02): the append-only
-- movement record, transfers between depots, and stocktakes. Also what the register needs
-- to know about them: an "in transit" status, who holds an item, when it is due back and
-- when it becomes overdue, which person looks after a van, and when a location was last
-- counted.
--
-- The rules live here, not in screens (DB-05, DB-07):
--  * a movement is evidence: never updated or deleted, for the app and the owner alike;
--  * the item's current location, holder and status are changed ONLY by the movement
--    trigger, in the same statement as the movement, so they can't drift from the record
--    (a guard trigger on register.items refuses any other change to them);
--  * only an available item can be checked out, and the error says why when it can't;
--  * a kit moves its parts with it, in the same transaction, and a part that is out on
--    its own blocks the kit, by name;
--  * an item in transit can't be checked out; a transfer is received at the destination
--    depot by a movement made there (the trigger is owner-run so it can see the item).
--
-- A transfer between depots changes the item's home depot when it is received. Photos
-- follow (ON UPDATE CASCADE). Movement rows keep the depot they happened at and point at
-- the item by id alone (a plain foreign key, not a composite one), because the item's
-- depot can change later; a trigger checks the depot matches at the time (K35).

CREATE SCHEMA movements AUTHORIZATION northkit_owner;
COMMENT ON SCHEMA movements IS 'Where kit is and who has it: the append-only movement record, transfers between depots and stocktakes (Sprint 3).';
GRANT USAGE ON SCHEMA movements TO northkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner IN SCHEMA movements
  GRANT SELECT, INSERT, UPDATE ON TABLES TO northkit_app;

-- ---------------------------------------------------------------- audit of partitioned tables
-- A row trigger on a partitioned table fires on the partition, whose name carries digits
-- (movements_y2026m11). The audit event names the table the rows belong to, not the month.
CREATE OR REPLACE FUNCTION audit.record_change() RETURNS trigger
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
  table_schema text := TG_TABLE_SCHEMA;
  table_name text := TG_TABLE_NAME;
BEGIN
  SELECT n.nspname, c.relname INTO table_schema, table_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE i.inhrelid = TG_RELID;
  IF NOT FOUND THEN
    table_schema := TG_TABLE_SCHEMA;
    table_name := TG_TABLE_NAME;
  END IF;

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
    WHEN table_schema = 'core' AND table_name = 'sites' THEN (subject ->> 'id')::uuid
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
          format('%s.%s.%s', table_schema, table_name, verb),
          format('%s.%s', table_schema, table_name),
          (subject ->> 'id')::uuid,
          event_site,
          old_row - secrets,
          new_row - secrets);
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION audit.record_change() IS 'AFTER INSERT/UPDATE/DELETE trigger writing one audit event per changed row, without secrets. Updates touching only bookkeeping columns are skipped. For a row in a partition it names the partitioned table, not the partition.';

-- ---------------------------------------------------------------- locations
ALTER TABLE core.locations
  ADD COLUMN assigned_user_id uuid REFERENCES core.users (id),
  ADD COLUMN last_counted_at timestamptz;
COMMENT ON COLUMN core.locations.assigned_user_id IS '[personal] For a van: the person who drives or looks after it, so "to my van" means this van. An Operative may check kit out to themselves and to their own van only. Null for other locations.';
COMMENT ON COLUMN core.locations.last_counted_at IS 'When a stocktake of this location was last closed (UTC); null if never counted. Locations not counted for longer than the recount setting need action.';

INSERT INTO core.settings (key, value, description) VALUES
  ('stocktake.recount_days', '30',
   'A store, cage, yard or van that has not been counted for longer than this many days appears in needs action.');

-- ---------------------------------------------------------------- kinds
ALTER TABLE register.kinds ADD COLUMN default_days_out integer CHECK (default_days_out BETWEEN 1 AND 365);
COMMENT ON COLUMN register.kinds.default_days_out IS 'Days this kind of kit is normally out for: the due-back date offered at check-out. Null uses the organisation setting checkout.default_days_out.';
UPDATE register.kinds SET default_days_out = CASE name
  WHEN 'Power tool' THEN 7
  WHEN 'Lifting gear' THEN 14
  WHEN 'Access equipment' THEN 14
  WHEN 'Ladder' THEN 7
  WHEN 'Harness' THEN 7
  WHEN 'PAT item' THEN 7
  WHEN 'Test instrument' THEN 3
  WHEN 'Plant' THEN 28 END;

-- ---------------------------------------------------------------- items
ALTER TABLE register.items DROP CONSTRAINT items_status_check;
ALTER TABLE register.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('available', 'out', 'in_transit', 'quarantined', 'missing', 'retired'));

ALTER TABLE register.items
  ADD COLUMN holder_user_id uuid REFERENCES core.users (id),
  ADD COLUMN due_back_on date,
  ADD COLUMN overdue_at timestamptz,
  ADD COLUMN checked_out_at timestamptz;
COMMENT ON COLUMN register.items.holder_user_id IS '[personal] The person holding the item while it is out to a person; null otherwise. Changed only by the movement trigger.';
COMMENT ON COLUMN register.items.due_back_on IS 'The date the item is due back, in the depot''s time zone; null if none was set. Changed only by the movement trigger.';
COMMENT ON COLUMN register.items.overdue_at IS 'The moment the item becomes overdue: the start of the day after due_back_on in the depot''s time zone (UTC). Later sprints'' reminders read this. Changed only by the movement trigger.';
COMMENT ON COLUMN register.items.checked_out_at IS 'When the item went out (UTC, as recorded on the phone if offline); null if it is not out. Changed only by the movement trigger.';
COMMENT ON COLUMN register.items.location_id IS 'Where the item is now (a store, van, yard or job site of the same depot); null if not placed yet, with a person, in transit or missing. Set at registration, then changed only by the movement trigger.';
COMMENT ON COLUMN register.items.status IS 'available, out (with a person, in a van or at a job site), in_transit (between depots), quarantined, missing or retired. Transitions are enforced by a trigger; out, in_transit and missing are set only by the movement trigger.';
ALTER TABLE register.items
  ADD CONSTRAINT items_holder_or_place CHECK (holder_user_id IS NULL OR location_id IS NULL),
  ADD CONSTRAINT items_out_fields CHECK (
    status = 'out' OR (holder_user_id IS NULL AND due_back_on IS NULL AND overdue_at IS NULL AND checked_out_at IS NULL)),
  ADD CONSTRAINT items_transit_missing_unplaced CHECK (
    status NOT IN ('in_transit', 'missing') OR (holder_user_id IS NULL AND location_id IS NULL));
CREATE INDEX items_holder ON register.items (holder_user_id) WHERE holder_user_id IS NOT NULL;
CREATE INDEX items_overdue ON register.items (overdue_at) WHERE overdue_at IS NOT NULL;

-- Photos follow the item to its new depot when a transfer is received.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'register.item_photos'::regclass AND contype = 'f'
     AND confrelid = 'register.items'::regclass;
  EXECUTE format('ALTER TABLE register.item_photos DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE register.item_photos
  ADD CONSTRAINT item_photos_site_id_item_id_fkey FOREIGN KEY (site_id, item_id)
  REFERENCES register.items (site_id, id) ON UPDATE CASCADE;

-- Status transitions, now with in_transit. quarantined is entered in Sprint 4.
CREATE OR REPLACE FUNCTION register.check_item_status() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'available' AND NEW.status IN ('out', 'in_transit', 'quarantined', 'missing', 'retired'))
    OR (OLD.status = 'out' AND NEW.status IN ('available', 'quarantined', 'missing'))
    OR (OLD.status = 'in_transit' AND NEW.status IN ('available', 'missing'))
    OR (OLD.status = 'quarantined' AND NEW.status IN ('available', 'missing', 'retired'))
    OR (OLD.status = 'missing' AND NEW.status IN ('available', 'out', 'retired'))) THEN
    RAISE EXCEPTION 'An item can''t go from % to %.', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'items_status_transition';
  END IF;
  IF NEW.status = 'retired' AND EXISTS (
       SELECT FROM register.items c WHERE c.parent_id = NEW.id AND c.status <> 'retired') THEN
    RAISE EXCEPTION 'Take the items out of this kit before retiring it.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'items_retire_kit_with_items';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION register.check_item_status() IS 'Trigger: only allowed status changes get through (available to out, in_transit, quarantined, missing or retired; out back to available, or to quarantined or missing; in_transit to available or missing; quarantined to available, missing or retired; missing to available, out (found in a van or on a site) or retired). A kit with items in it can''t be retired.';

-- The guard: where an item is, who holds it and whether it is out, in transit or missing
-- change only through a movement. The movement trigger updates items from inside its own
-- trigger (depth 2 or more); any change made directly (depth 1) is refused.
CREATE FUNCTION register.guard_item_whereabouts() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() < 2 AND (
       NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.holder_user_id IS DISTINCT FROM OLD.holder_user_id
    OR NEW.due_back_on IS DISTINCT FROM OLD.due_back_on
    OR NEW.overdue_at IS DISTINCT FROM OLD.overdue_at
    OR NEW.checked_out_at IS DISTINCT FROM OLD.checked_out_at
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR (NEW.status IS DISTINCT FROM OLD.status
        AND (NEW.status IN ('out', 'in_transit', 'missing') OR OLD.status IN ('out', 'in_transit')
             OR (OLD.status = 'missing' AND NEW.status <> 'retired')))) THEN
    RAISE EXCEPTION 'Where an item is changes only by checking it out or in, moving it, a transfer or a stocktake.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'items_whereabouts_by_movement';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION register.guard_item_whereabouts() IS 'Trigger: refuses a direct change to an item''s location, holder, due-back date, depot, or to or from out, in transit or missing. Only the movement trigger may make them, so the current position can''t drift from the movement record.';
CREATE TRIGGER guard_item_whereabouts BEFORE UPDATE ON register.items
  FOR EACH ROW EXECUTE FUNCTION register.guard_item_whereabouts();

-- ---------------------------------------------------------------- transfers
-- A transfer sends an item to another depot (in transit) and is received there. It is a
-- workflow record: the movement trigger changes its status, nothing else does. Both
-- depots can read it; only the sending depot can create it.
CREATE TABLE movements.transfers (
  id                   uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id              uuid NOT NULL REFERENCES core.sites (id),
  to_site_id           uuid NOT NULL REFERENCES core.sites (id),
  item_id              uuid NOT NULL REFERENCES register.items (id),
  kit_transfer_id      uuid REFERENCES movements.transfers (id),
  asset_number         text NOT NULL,
  kind_name            text NOT NULL,
  carrier              text NOT NULL CHECK (length(btrim(carrier)) BETWEEN 1 AND 200),
  expected_on          date NOT NULL,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  note                 text CHECK (length(note) <= 1000),
  status               text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  closed_at            timestamptz,
  closed_by            uuid REFERENCES core.users (id),
  received_location_id uuid REFERENCES core.locations (id),
  received_note        text CHECK (length(received_note) <= 1000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES core.users (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES core.users (id),
  row_version          integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (site_id, id),
  CONSTRAINT transfers_different_depots CHECK (site_id <> to_site_id),
  CONSTRAINT transfers_closed CHECK (
    (status = 'in_transit' AND closed_at IS NULL AND closed_by IS NULL AND received_location_id IS NULL)
    OR (status <> 'in_transit' AND closed_at IS NOT NULL))
);
SELECT public.apply_standard_columns('movements.transfers');
SELECT audit.track('movements.transfers');
-- Both depots can read; only the sending depot can write (the receiving depot's side is
-- done by the owner-run movement trigger).
ALTER TABLE movements.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE movements.transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY site_isolation ON movements.transfers TO northkit_app
  USING (site_id = ANY (public.current_site_ids()) OR to_site_id = ANY (public.current_site_ids()))
  WITH CHECK (site_id = ANY (public.current_site_ids()));
CREATE POLICY owner_access ON movements.transfers TO northkit_owner USING (true) WITH CHECK (true);
CREATE POLICY reporting_read ON movements.transfers FOR SELECT TO northkit_readonly USING (true);
CREATE UNIQUE INDEX transfers_one_open_per_item ON movements.transfers (item_id) WHERE status = 'in_transit';
CREATE INDEX transfers_open_to ON movements.transfers (to_site_id, expected_on) WHERE status = 'in_transit';
CREATE INDEX transfers_open_from ON movements.transfers (site_id, expected_on) WHERE status = 'in_transit';
COMMENT ON TABLE movements.transfers IS 'An item sent from one depot to another. In transit until received at the destination by a transfer_in movement made there (or cancelled by the sender). Site-owned by the sending depot (site_id); the receiving depot can also read it. Kit parts have their own rows pointing at the kit''s.';
COMMENT ON COLUMN movements.transfers.site_id IS 'The sending depot (row-level security key, DB-06). The receiving depot sees the row through to_site_id.';
COMMENT ON COLUMN movements.transfers.to_site_id IS 'The receiving depot.';
COMMENT ON COLUMN movements.transfers.item_id IS 'The item sent. A plain foreign key: the item''s depot changes when the transfer is received.';
COMMENT ON COLUMN movements.transfers.kit_transfer_id IS 'For a part of a kit sent with it: the kit''s transfer.';
COMMENT ON COLUMN movements.transfers.asset_number IS 'The item''s asset number when sent, so the receiving depot can show it before it can see the item.';
COMMENT ON COLUMN movements.transfers.kind_name IS 'The item''s kind when sent, for the same reason.';
COMMENT ON COLUMN movements.transfers.carrier IS 'Who or what carries it: a carrier, a van or a person, as typed.';
COMMENT ON COLUMN movements.transfers.expected_on IS 'The date it should arrive, in the sending depot''s time zone. Not received by then, it needs action at both depots.';
COMMENT ON COLUMN movements.transfers.sent_at IS 'When it was sent (UTC, as recorded on the phone if offline).';
COMMENT ON COLUMN movements.transfers.note IS 'Note from the sender.';
COMMENT ON COLUMN movements.transfers.status IS 'in_transit, received (at the destination) or cancelled (taken back by the sender).';
COMMENT ON COLUMN movements.transfers.closed_at IS 'When it was received or cancelled (UTC); set by the movement trigger.';
COMMENT ON COLUMN movements.transfers.closed_by IS '[personal] Who received or cancelled it; set by the movement trigger.';
COMMENT ON COLUMN movements.transfers.received_location_id IS 'Where in the receiving depot it was put (or, if cancelled, where in the sending depot); set by the movement trigger.';
COMMENT ON COLUMN movements.transfers.received_note IS 'Note from the receiver.';

-- A transfer's row changes only to close it, and only by the movement trigger.
CREATE FUNCTION movements.guard_transfer() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() < 2 AND (
       (to_jsonb(NEW) - ARRAY['updated_at', 'updated_by', 'row_version'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'updated_by', 'row_version'])) THEN
    RAISE EXCEPTION 'A transfer is received or cancelled by recording it, not by editing it.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transfers_closed_by_movement';
  END IF;
  IF OLD.status <> 'in_transit' THEN
    RAISE EXCEPTION 'A closed transfer can''t be changed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transfers_closed_final';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION movements.guard_transfer() IS 'Trigger: a transfer changes only when the movement trigger closes it, and a closed transfer never changes.';
CREATE TRIGGER guard_transfer BEFORE UPDATE ON movements.transfers
  FOR EACH ROW EXECUTE FUNCTION movements.guard_transfer();
CREATE FUNCTION movements.refuse_transfer_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A transfer is a record and can''t be deleted.' USING ERRCODE = 'insufficient_privilege';
END
$$;
COMMENT ON FUNCTION movements.refuse_transfer_delete() IS 'Trigger: transfers are never deleted.';
CREATE TRIGGER refuse_delete BEFORE DELETE ON movements.transfers
  FOR EACH ROW EXECUTE FUNCTION movements.refuse_transfer_delete();

-- ---------------------------------------------------------------- stocktakes
CREATE TABLE movements.stocktakes (
  id                uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id           uuid NOT NULL REFERENCES core.sites (id),
  location_id       uuid NOT NULL,
  status            text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'closed')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES core.users (id),
  expected_count    integer CHECK (expected_count >= 0),
  found_count       integer CHECK (found_count >= 0),
  not_found_count   integer CHECK (not_found_count >= 0),
  unexpected_count  integer CHECK (unexpected_count >= 0),
  note              text CHECK (length(note) <= 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES core.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES core.users (id),
  row_version       integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (site_id, id),
  FOREIGN KEY (site_id, location_id) REFERENCES core.locations (site_id, id),
  CONSTRAINT stocktakes_closed CHECK (
    (status = 'counting' AND closed_at IS NULL AND closed_by IS NULL AND expected_count IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND expected_count IS NOT NULL
        AND found_count IS NOT NULL AND not_found_count IS NOT NULL AND unexpected_count IS NOT NULL))
);
SELECT public.apply_standard_columns('movements.stocktakes');
SELECT public.enable_site_isolation('movements.stocktakes');
SELECT audit.track('movements.stocktakes');
CREATE UNIQUE INDEX stocktakes_one_counting_per_location ON movements.stocktakes (location_id) WHERE status = 'counting';
CREATE INDEX stocktakes_location ON movements.stocktakes (location_id, started_at DESC);
COMMENT ON TABLE movements.stocktakes IS 'A count of one location (a store, cage, yard or van): scan everything physically there, then close it with the choices made. At most one is being counted per location. Closed ones are never changed.';
COMMENT ON COLUMN movements.stocktakes.location_id IS 'The location counted, in the same depot.';
COMMENT ON COLUMN movements.stocktakes.status IS 'counting (scans are being added) or closed (the result is recorded and its choices applied).';
COMMENT ON COLUMN movements.stocktakes.started_at IS 'When counting began (UTC, as recorded on the phone if offline).';
COMMENT ON COLUMN movements.stocktakes.closed_at IS 'When it was closed (UTC).';
COMMENT ON COLUMN movements.stocktakes.closed_by IS '[personal] Who closed it.';
COMMENT ON COLUMN movements.stocktakes.expected_count IS 'Items the register expected at the location when it was closed.';
COMMENT ON COLUMN movements.stocktakes.found_count IS 'Expected items that were scanned.';
COMMENT ON COLUMN movements.stocktakes.not_found_count IS 'Expected items that were not scanned.';
COMMENT ON COLUMN movements.stocktakes.unexpected_count IS 'Items scanned that the register did not expect there.';
COMMENT ON COLUMN movements.stocktakes.note IS 'Note from whoever counted.';

CREATE TABLE movements.stocktake_lines (
  id            uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id       uuid NOT NULL REFERENCES core.sites (id),
  stocktake_id  uuid NOT NULL,
  item_id       uuid NOT NULL REFERENCES register.items (id),
  scanned_at    timestamptz,
  scanned_by    uuid REFERENCES core.users (id),
  expected      boolean,
  outcome       text CHECK (outcome IN ('found', 'not_found', 'unexpected')),
  decision      text CHECK (decision IN ('missing', 'ignored', 'moved_here', 'note_only')),
  reason        text CHECK (length(reason) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES core.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES core.users (id),
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (stocktake_id, item_id),
  FOREIGN KEY (site_id, stocktake_id) REFERENCES movements.stocktakes (site_id, id),
  CONSTRAINT stocktake_lines_decision CHECK (
    (outcome IS NULL AND decision IS NULL)
    OR (outcome = 'found' AND decision IS NULL)
    OR (outcome = 'not_found' AND decision IN ('missing', 'ignored'))
    OR (outcome = 'unexpected' AND decision IN ('moved_here', 'note_only'))),
  CONSTRAINT stocktake_lines_ignored_reason CHECK (decision IS DISTINCT FROM 'ignored' OR coalesce(length(btrim(reason)), 0) >= 3)
);
SELECT public.apply_standard_columns('movements.stocktake_lines');
SELECT public.enable_site_isolation('movements.stocktake_lines');
SELECT audit.track('movements.stocktake_lines');
CREATE INDEX stocktake_lines_item ON movements.stocktake_lines (item_id);
COMMENT ON TABLE movements.stocktake_lines IS 'One row per item scanned or expected in a stocktake. Scans add rows while counting; closing sets what each row turned out to be and the choice made. Frozen once the stocktake is closed.';
COMMENT ON COLUMN movements.stocktake_lines.stocktake_id IS 'The stocktake, in the same depot.';
COMMENT ON COLUMN movements.stocktake_lines.item_id IS 'The item. A plain foreign key: an item''s depot can change by transfer.';
COMMENT ON COLUMN movements.stocktake_lines.scanned_at IS 'When it was scanned (UTC, as recorded on the phone if offline); null if it was expected but never scanned.';
COMMENT ON COLUMN movements.stocktake_lines.scanned_by IS '[personal] Who scanned it.';
COMMENT ON COLUMN movements.stocktake_lines.expected IS 'Whether the register expected the item at the location when the stocktake closed; null while counting.';
COMMENT ON COLUMN movements.stocktake_lines.outcome IS 'found (expected and scanned), not_found (expected, not scanned) or unexpected (scanned, not expected there); set when closed.';
COMMENT ON COLUMN movements.stocktake_lines.decision IS 'The choice made: missing or ignored for not_found; moved_here or note_only for unexpected. Only these choices are applied.';
COMMENT ON COLUMN movements.stocktake_lines.reason IS 'Why a not-found item was ignored (required then).';

CREATE FUNCTION movements.guard_stocktake() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'A closed stocktake can''t be changed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stocktakes_closed_final';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION movements.guard_stocktake() IS 'Trigger: a closed stocktake never changes.';
CREATE TRIGGER guard_stocktake BEFORE UPDATE ON movements.stocktakes
  FOR EACH ROW EXECUTE FUNCTION movements.guard_stocktake();

CREATE FUNCTION movements.guard_stocktake_line() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT status FROM movements.stocktakes WHERE id = NEW.stocktake_id) = 'closed' THEN
    RAISE EXCEPTION 'This stocktake is closed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stocktake_lines_closed_final';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION movements.guard_stocktake_line() IS 'Trigger: nothing is added to or changed in a closed stocktake.';
CREATE TRIGGER guard_stocktake_line BEFORE INSERT OR UPDATE ON movements.stocktake_lines
  FOR EACH ROW EXECUTE FUNCTION movements.guard_stocktake_line();

-- ---------------------------------------------------------------- movements
-- The record. Partitioned by month on occurred_at (DB-08); with id forms the primary key,
-- so a phone's replay of the same movement (same id, same occurred_at) is recognised.
CREATE TABLE movements.movements (
  id               uuid NOT NULL DEFAULT public.uuid_v7(),
  site_id          uuid NOT NULL REFERENCES core.sites (id),
  item_id          uuid NOT NULL REFERENCES register.items (id),
  movement_type    text NOT NULL CHECK (movement_type IN
    ('check_out', 'check_in', 'move', 'missing', 'found', 'transfer_out', 'transfer_in', 'transfer_cancel')),
  from_user_id     uuid REFERENCES core.users (id),
  from_location_id uuid,
  to_user_id       uuid REFERENCES core.users (id),
  to_location_id   uuid,
  due_back_on      date,
  note             text CHECK (length(note) <= 1000),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  via_kit_id       uuid REFERENCES register.items (id),
  transfer_id      uuid REFERENCES movements.transfers (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES core.users (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES core.users (id),
  row_version      integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  PRIMARY KEY (id, occurred_at),
  FOREIGN KEY (site_id, from_location_id) REFERENCES core.locations (site_id, id),
  FOREIGN KEY (site_id, to_location_id) REFERENCES core.locations (site_id, id),
  CONSTRAINT movements_one_destination CHECK (num_nonnulls(to_user_id, to_location_id) <= 1),
  CONSTRAINT movements_due_back_only_out CHECK (due_back_on IS NULL OR movement_type = 'check_out'),
  CONSTRAINT movements_transfer_has_transfer CHECK (
    (movement_type IN ('transfer_out', 'transfer_in', 'transfer_cancel')) = (transfer_id IS NOT NULL))
) PARTITION BY RANGE (occurred_at);
SELECT public.apply_standard_columns('movements.movements');
SELECT audit.track('movements.movements');
CREATE INDEX movements_item ON movements.movements (item_id, occurred_at DESC);
CREATE INDEX movements_site_time ON movements.movements (site_id, occurred_at DESC);
CREATE INDEX movements_id ON movements.movements (id);
COMMENT ON TABLE movements.movements IS 'Evidence: every check-out, check-in, move, missing report, found, and transfer step, by whom and when. Never updated or deleted (DB-04); a correction is a new row. Inserting a row is what changes the item''s position, status and holder (trigger), so the two can''t differ. Partitioned by month on occurred_at.';
COMMENT ON COLUMN movements.movements.id IS 'Movement id, a UUIDv7; a phone supplies its own so a replay is recognised and applied once. With occurred_at forms the primary key.';
COMMENT ON COLUMN movements.movements.site_id IS 'The depot the movement happened at: the item''s home depot then (row-level security key, DB-06). For transfer_in, the receiving depot.';
COMMENT ON COLUMN movements.movements.item_id IS 'The item moved. A plain foreign key, because an item''s depot can change by transfer; a trigger checks site_id is the item''s depot at the time.';
COMMENT ON COLUMN movements.movements.movement_type IS 'check_out, check_in, move (a stocktake relocation), missing, found, transfer_out, transfer_in (received) or transfer_cancel (taken back by the sender).';
COMMENT ON COLUMN movements.movements.from_user_id IS '[personal] Who held the item before; filled in by the trigger from the item, never typed.';
COMMENT ON COLUMN movements.movements.from_location_id IS 'Where the item was before; filled in by the trigger from the item, never typed.';
COMMENT ON COLUMN movements.movements.to_user_id IS '[personal] The person it went to (a check-out to a person).';
COMMENT ON COLUMN movements.movements.to_location_id IS 'The location it went to, in the same depot (a van, job site, store or yard).';
COMMENT ON COLUMN movements.movements.due_back_on IS 'For a check-out: the date it is due back, in the depot''s time zone.';
COMMENT ON COLUMN movements.movements.note IS 'A note: the condition on check-in, why it was moved, where it was found.';
COMMENT ON COLUMN movements.movements.occurred_at IS 'When it happened (UTC): the phone''s clock for a change made offline, otherwise now. Also the partition key. created_at says when it reached the server.';
COMMENT ON COLUMN movements.movements.via_kit_id IS 'If the item moved because the kit it is part of moved: that kit.';
COMMENT ON COLUMN movements.movements.transfer_id IS 'For transfer_out, transfer_in and transfer_cancel: the transfer.';

-- Evidence: never updated or deleted, for the app and the owner alike.
REVOKE UPDATE, DELETE, TRUNCATE ON movements.movements FROM northkit_app;
CREATE FUNCTION movements.refuse_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'A movement is a record and can''t be changed or deleted: record a new one.'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
COMMENT ON FUNCTION movements.refuse_change() IS 'Trigger that blocks UPDATE and DELETE on movements: they are evidence, corrected only by a new row.';
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON movements.movements
  FOR EACH ROW EXECUTE FUNCTION movements.refuse_change();

-- Monthly partitions, rolled by the worker each day like the audit log's. Each carries the
-- site policies, as check-rls requires of every table with a site_id.
CREATE FUNCTION movements.ensure_partitions(months_back integer DEFAULT 6, months_ahead integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  part_start date;
  part_name text;
  created integer := 0;
BEGIN
  IF months_back < 0 OR months_back > 120 OR months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_back must be 0 to 120 and months_ahead 0 to 24';
  END IF;
  FOR i IN -months_back..months_ahead LOOP
    part_start := (month_start + make_interval(months => i))::date;
    part_name := format('movements_y%sm%s', to_char(part_start, 'YYYY'), to_char(part_start, 'MM'));
    CONTINUE WHEN to_regclass(format('movements.%I', part_name)) IS NOT NULL;
    EXECUTE format(
      'CREATE TABLE movements.%I PARTITION OF movements.movements FOR VALUES FROM (%L) TO (%L)',
      part_name,
      (part_start::timestamp AT TIME ZONE 'UTC'),
      ((part_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
    EXECUTE format('REVOKE ALL ON movements.%I FROM northkit_app, northkit_readonly', part_name);
    PERFORM public.enable_site_isolation(format('movements.%I', part_name)::regclass);
    EXECUTE format('COMMENT ON TABLE movements.%I IS %L', part_name,
      format('Movements for %s (partition of movements.movements).', to_char(part_start, 'FMMonth YYYY')));
    created := created + 1;
  END LOOP;
  RETURN created;
END
$$;
ALTER FUNCTION movements.ensure_partitions(integer, integer) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION movements.ensure_partitions(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION movements.ensure_partitions(integer, integer) TO northkit_app;
COMMENT ON FUNCTION movements.ensure_partitions(integer, integer) IS 'Creates missing monthly movement partitions from months_back months ago to months_ahead months ahead; returns how many it made. Run daily by the worker. A phone that was offline for months still finds its month.';

SELECT movements.ensure_partitions(6, 3);

-- The parent's policies (the partitions carry their own, as above).
SELECT public.enable_site_isolation('movements.movements');

-- ---------------------------------------------------------------- the movement trigger
-- Applies a movement to the item, in the same statement. Runs as the owner so a
-- transfer can be received by a depot that can't yet see the item; it checks the caller's
-- depot scope itself first. Everything it refuses says why, in plain words.
CREATE FUNCTION movements.item_label(p_item register.items) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT p_item.asset_number $$;
COMMENT ON FUNCTION movements.item_label(register.items) IS 'The asset number used in refusal messages.';

CREATE FUNCTION movements.why_not_available(p_item register.items) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE p_item.status
    WHEN 'out' THEN p_item.asset_number || ' is already out. Check it in first.'
    WHEN 'in_transit' THEN p_item.asset_number || ' is in transit to another depot. Receive it there first.'
    WHEN 'quarantined' THEN p_item.asset_number || ' is quarantined and can''t be checked out until a passed inspection is recorded.'
    WHEN 'missing' THEN p_item.asset_number || ' is reported missing. Record it as found first.'
    WHEN 'retired' THEN p_item.asset_number || ' is retired and can''t be moved.'
    ELSE p_item.asset_number || ' isn''t available.' END
$$;
COMMENT ON FUNCTION movements.why_not_available(register.items) IS 'The reason an item can''t be checked out, in plain words, for refusal messages.';

CREATE FUNCTION movements.apply_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  it register.items%ROWTYPE;
  kit register.items%ROWTYPE;
  child register.items%ROWTYPE;
  dest core.locations%ROWTYPE;
  tr movements.transfers%ROWTYPE;
  zone text;
  new_status text;
  new_holder uuid;
  new_location uuid;
  new_due date;
  new_overdue timestamptz;
  new_out_at timestamptz;
  new_site uuid;
  part_ids uuid[];
  part_from text[];
BEGIN
  -- A kit's parts are moved by their kit, in bulk: the kit's own movement already did it.
  IF current_setting('northkit.cascade', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'That time is in the future. Check the clock on this phone.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_not_future';
  END IF;
  -- The app's depot scope applies to it; the owner and the superuser (migrations, seeding, repair) are trusted.
  IF session_user = 'northkit_app' AND NOT (NEW.site_id = ANY (public.current_site_ids())) THEN
    RAISE EXCEPTION 'You can''t record movements at that depot.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO it FROM register.items WHERE id = NEW.item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF it.site_id <> NEW.site_id AND NEW.movement_type <> 'transfer_in' THEN
    RAISE EXCEPTION 'Item not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Where it was: always taken from the item, never from the caller.
  NEW.from_user_id := it.holder_user_id;
  NEW.from_location_id := it.location_id;
  IF NEW.movement_type = 'transfer_in' THEN
    NEW.from_location_id := NULL;
  END IF;

  -- Kit parts move with their kit, never alone while the kit is out or away.
  IF it.parent_id IS NOT NULL AND NEW.via_kit_id IS NULL THEN
    SELECT * INTO kit FROM register.items WHERE id = it.parent_id;
    IF NEW.movement_type IN ('check_in', 'move', 'transfer_out', 'transfer_in', 'transfer_cancel')
       AND kit.status IN ('out', 'in_transit') THEN
      RAISE EXCEPTION '% is part of kit % (%). Move the kit, not its part.', it.asset_number, kit.asset_number, kit.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_part_of_kit';
    END IF;
    IF NEW.movement_type IN ('transfer_out', 'transfer_in', 'transfer_cancel') THEN
      RAISE EXCEPTION '% is part of kit %. Send the kit, not its part.', it.asset_number, kit.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_part_of_kit';
    END IF;
  END IF;

  zone := coalesce((SELECT time_zone FROM core.sites WHERE id = NEW.site_id), 'UTC');
  new_site := it.site_id;
  new_status := it.status;
  new_holder := NULL;
  new_location := NULL;
  new_due := NULL;
  new_overdue := NULL;
  new_out_at := NULL;

  IF NEW.movement_type = 'check_out' THEN
    IF it.status <> 'available' THEN
      RAISE EXCEPTION '%', movements.why_not_available(it)
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_check_out_available';
    END IF;
    IF num_nonnulls(NEW.to_user_id, NEW.to_location_id) <> 1 THEN
      RAISE EXCEPTION 'Choose who or where % is going to.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_needs_destination';
    END IF;
    IF it.is_kit THEN
      SELECT * INTO child FROM register.items c
       WHERE c.parent_id = it.id AND c.status NOT IN ('available', 'retired') ORDER BY c.asset_number LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Kit % can''t be checked out: its item % is %.', it.asset_number, child.asset_number,
          CASE child.status WHEN 'out' THEN 'out on its own' WHEN 'in_transit' THEN 'in transit'
            WHEN 'quarantined' THEN 'quarantined' WHEN 'missing' THEN 'missing' ELSE child.status END
          USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_kit_part_unavailable';
      END IF;
    END IF;
    IF NEW.to_location_id IS NOT NULL THEN
      SELECT * INTO dest FROM core.locations WHERE id = NEW.to_location_id;
      IF dest.archived_at IS NOT NULL THEN
        RAISE EXCEPTION '% is archived: choose another place.', dest.name
          USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_location_archived';
      END IF;
    END IF;
    -- To a person, a van or a job site the item goes out; to a store or yard it is relocated.
    IF NEW.to_user_id IS NOT NULL OR dest.kind IN ('van', 'site') THEN
      new_status := 'out';
      new_out_at := NEW.occurred_at;
      new_due := NEW.due_back_on;
      IF new_due IS NOT NULL THEN
        IF new_due < (NEW.occurred_at AT TIME ZONE zone)::date THEN
          RAISE EXCEPTION 'The due-back date can''t be before today.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_due_back_past';
        END IF;
        new_overdue := ((new_due + 1)::timestamp AT TIME ZONE zone);
      END IF;
    ELSIF NEW.due_back_on IS NOT NULL THEN
      RAISE EXCEPTION 'A due-back date is for kit going out to a person, a van or a job site.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_due_back_place';
    ELSE
      new_status := 'available';
    END IF;
    new_holder := NEW.to_user_id;
    new_location := NEW.to_location_id;

  ELSIF NEW.movement_type = 'check_in' THEN
    IF it.status <> 'out' THEN
      RAISE EXCEPTION '% isn''t out, so there is nothing to check in.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_check_in_out';
    END IF;
    IF NEW.to_location_id IS NULL OR NEW.to_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose where % is being returned to.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_needs_destination';
    END IF;
    SELECT * INTO dest FROM core.locations WHERE id = NEW.to_location_id;
    IF dest.archived_at IS NOT NULL THEN
      RAISE EXCEPTION '% is archived: choose another place.', dest.name
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_location_archived';
    END IF;
    new_status := 'available';
    new_location := NEW.to_location_id;

  ELSIF NEW.movement_type IN ('move', 'found') THEN
    IF NEW.movement_type = 'move' AND it.status NOT IN ('available', 'out') THEN
      RAISE EXCEPTION '%', movements.why_not_available(it)
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_move_status';
    END IF;
    IF NEW.movement_type = 'found' AND it.status <> 'missing' THEN
      RAISE EXCEPTION '% isn''t reported missing.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_found_missing';
    END IF;
    IF NEW.to_location_id IS NULL OR NEW.to_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose where % is.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_needs_destination';
    END IF;
    SELECT * INTO dest FROM core.locations WHERE id = NEW.to_location_id;
    IF dest.archived_at IS NOT NULL THEN
      RAISE EXCEPTION '% is archived: choose another place.', dest.name
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_location_archived';
    END IF;
    -- Found in a van or on a job site it is out there (no due date); in a store or yard, available.
    new_status := CASE WHEN dest.kind IN ('van', 'site') THEN 'out' ELSE 'available' END;
    IF new_status = 'out' THEN new_out_at := NEW.occurred_at; END IF;
    new_location := NEW.to_location_id;

  ELSIF NEW.movement_type = 'missing' THEN
    IF it.status NOT IN ('available', 'out', 'quarantined') THEN
      RAISE EXCEPTION '% can''t be reported missing: it is %.', it.asset_number,
        replace(it.status, '_', ' ')
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_missing_status';
    END IF;
    IF NEW.to_user_id IS NOT NULL OR NEW.to_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'A missing item has no destination.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_missing_destination';
    END IF;
    new_status := 'missing';

  ELSIF NEW.movement_type = 'transfer_out' THEN
    IF it.status <> 'available' THEN
      RAISE EXCEPTION '%', movements.why_not_available(it)
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_transfer_available';
    END IF;
    SELECT * INTO tr FROM movements.transfers WHERE id = NEW.transfer_id;
    IF NOT FOUND OR tr.item_id <> it.id OR tr.site_id <> NEW.site_id OR tr.status <> 'in_transit' THEN
      RAISE EXCEPTION 'That transfer doesn''t match this item.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_transfer_match';
    END IF;
    IF it.is_kit THEN
      SELECT * INTO child FROM register.items c
       WHERE c.parent_id = it.id AND c.status NOT IN ('available', 'retired') ORDER BY c.asset_number LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'Kit % can''t be sent: its item % isn''t available.', it.asset_number, child.asset_number
          USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_kit_part_unavailable';
      END IF;
    END IF;
    new_status := 'in_transit';

  ELSIF NEW.movement_type = 'transfer_in' THEN
    SELECT * INTO tr FROM movements.transfers WHERE id = NEW.transfer_id FOR UPDATE;
    IF NOT FOUND OR tr.item_id <> it.id OR tr.to_site_id <> NEW.site_id OR tr.status <> 'in_transit' THEN
      RAISE EXCEPTION 'There is no transfer of % waiting to be received here.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_transfer_match';
    END IF;
    IF it.status <> 'in_transit' THEN
      RAISE EXCEPTION '% isn''t in transit.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_transfer_in_transit';
    END IF;
    IF NEW.to_location_id IS NULL OR NEW.to_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose where % is being put.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_needs_destination';
    END IF;
    SELECT * INTO dest FROM core.locations WHERE id = NEW.to_location_id;
    IF dest.archived_at IS NOT NULL THEN
      RAISE EXCEPTION '% is archived: choose another place.', dest.name
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_location_archived';
    END IF;
    new_status := 'available';
    new_location := NEW.to_location_id;
    new_site := NEW.site_id;

  ELSIF NEW.movement_type = 'transfer_cancel' THEN
    SELECT * INTO tr FROM movements.transfers WHERE id = NEW.transfer_id FOR UPDATE;
    IF NOT FOUND OR tr.item_id <> it.id OR tr.site_id <> NEW.site_id OR tr.status <> 'in_transit' THEN
      RAISE EXCEPTION 'There is no transfer of % to cancel.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_transfer_match';
    END IF;
    IF NEW.to_location_id IS NULL OR NEW.to_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Choose where % is being put back.', it.asset_number
        USING ERRCODE = 'check_violation', CONSTRAINT = 'movements_needs_destination';
    END IF;
    new_status := 'available';
    new_location := NEW.to_location_id;
  END IF;

  -- The item itself and, for a kit, its parts. A part changes only from the status the
  -- kit's movement applies to, and gets a movement row of its own, flagged as applied.
  IF NEW.movement_type = 'transfer_in' THEN
    -- Parent and parts change depot in ONE statement, so the (site_id, parent_id) key holds.
    WITH moved AS (
      UPDATE register.items c SET
        site_id = new_site, status = new_status, holder_user_id = NULL, location_id = new_location,
        due_back_on = NULL, overdue_at = NULL, checked_out_at = NULL
       WHERE c.id = it.id OR (c.parent_id = it.id AND c.status = 'in_transit')
      RETURNING c.id)
    SELECT array_agg(id) FILTER (WHERE id <> it.id) INTO part_ids FROM moved;
  ELSE
    UPDATE register.items SET
      status = new_status, holder_user_id = new_holder, location_id = new_location,
      due_back_on = new_due, overdue_at = new_overdue, checked_out_at = new_out_at
     WHERE id = it.id;
    IF it.is_kit THEN
      part_from := CASE NEW.movement_type
        WHEN 'check_out' THEN ARRAY['available'] WHEN 'transfer_out' THEN ARRAY['available']
        WHEN 'check_in' THEN ARRAY['out'] WHEN 'found' THEN ARRAY['missing']
        WHEN 'transfer_cancel' THEN ARRAY['in_transit']
        ELSE ARRAY['available', 'out'] END;
      WITH moved AS (
        UPDATE register.items c SET
          status = new_status, holder_user_id = new_holder, location_id = new_location,
          due_back_on = new_due, overdue_at = new_overdue, checked_out_at = new_out_at
         WHERE c.parent_id = it.id AND c.status = ANY (part_from)
        RETURNING c.id)
      SELECT array_agg(id) INTO part_ids FROM moved;
    END IF;
  END IF;

  IF part_ids IS NOT NULL THEN
    PERFORM set_config('northkit.cascade', 'on', true);
    INSERT INTO movements.movements
      (site_id, item_id, movement_type, from_user_id, from_location_id, to_user_id, to_location_id,
       due_back_on, note, occurred_at, via_kit_id, transfer_id)
    SELECT NEW.site_id, p.id, NEW.movement_type, NEW.from_user_id, NEW.from_location_id, NEW.to_user_id,
           NEW.to_location_id, NEW.due_back_on, NEW.note, NEW.occurred_at, it.id,
           (SELECT t.id FROM movements.transfers t
             WHERE t.item_id = p.id AND t.kit_transfer_id = NEW.transfer_id
             ORDER BY t.created_at DESC LIMIT 1)
      FROM unnest(part_ids) AS p (id);
    PERFORM set_config('northkit.cascade', 'off', true);
  END IF;

  -- Close the transfer, here, so the two can't disagree.
  IF NEW.movement_type IN ('transfer_in', 'transfer_cancel') THEN
    UPDATE movements.transfers SET
      status = CASE NEW.movement_type WHEN 'transfer_in' THEN 'received' ELSE 'cancelled' END,
      closed_at = NEW.occurred_at, closed_by = public.current_user_id(),
      received_location_id = NEW.to_location_id, received_note = NEW.note
     WHERE id = tr.id OR kit_transfer_id = tr.id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION movements.apply_movement() OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION movements.apply_movement() FROM PUBLIC;
COMMENT ON FUNCTION movements.apply_movement() IS 'BEFORE INSERT trigger on movements, run as the owner. Checks the rule for the kind of movement (only an available item goes out; a kit moves with its parts and is blocked by a part that is out on its own; an item in transit or quarantined can''t go out; a transfer is received at the destination depot), then sets the item''s status, holder, location and due-back date and closes the transfer, all in the same statement. The caller''s depot scope is checked first.';
CREATE TRIGGER apply_movement BEFORE INSERT ON movements.movements
  FOR EACH ROW EXECUTE FUNCTION movements.apply_movement();

-- ---------------------------------------------------------------- reporting views (DB-10)
CREATE VIEW reporting.movements AS
  SELECT m.id AS movement_id, s.code AS site_code, i.asset_number, m.movement_type,
         m.from_user_id, fl.code AS from_location_code, m.to_user_id, tl.code AS to_location_code,
         m.due_back_on, m.note, m.occurred_at, m.created_at AS recorded_at, m.created_by AS recorded_by
    FROM movements.movements m
    JOIN core.sites s ON s.id = m.site_id
    JOIN register.items i ON i.id = m.item_id
    LEFT JOIN core.locations fl ON fl.id = m.from_location_id
    LEFT JOIN core.locations tl ON tl.id = m.to_location_id;
COMMENT ON VIEW reporting.movements IS 'Every check-out, check-in, move, missing report, found and transfer step, for Power BI and Excel.';
COMMENT ON COLUMN reporting.movements.movement_id IS 'Movement id (movements.movements.id).';
COMMENT ON COLUMN reporting.movements.site_code IS 'The depot it happened at.';
COMMENT ON COLUMN reporting.movements.asset_number IS 'The item''s asset number.';
COMMENT ON COLUMN reporting.movements.movement_type IS 'check_out, check_in, move, missing, found, transfer_out, transfer_in or transfer_cancel.';
COMMENT ON COLUMN reporting.movements.from_user_id IS '[personal] Who held the item before (a user id).';
COMMENT ON COLUMN reporting.movements.from_location_code IS 'Where the item was before.';
COMMENT ON COLUMN reporting.movements.to_user_id IS '[personal] The person it went to (a user id).';
COMMENT ON COLUMN reporting.movements.to_location_code IS 'The location it went to.';
COMMENT ON COLUMN reporting.movements.due_back_on IS 'For a check-out: the date it is due back.';
COMMENT ON COLUMN reporting.movements.note IS 'The note recorded with it.';
COMMENT ON COLUMN reporting.movements.occurred_at IS 'When it happened (UTC).';
COMMENT ON COLUMN reporting.movements.recorded_at IS 'When it reached the server (UTC).';
COMMENT ON COLUMN reporting.movements.recorded_by IS '[personal] Who recorded it (a user id).';

CREATE VIEW reporting.transfers AS
  SELECT t.id AS transfer_id, f.code AS from_site_code, d.code AS to_site_code, t.asset_number, t.kind_name,
         t.carrier, t.expected_on, t.sent_at, t.status, t.closed_at
    FROM movements.transfers t
    JOIN core.sites f ON f.id = t.site_id
    JOIN core.sites d ON d.id = t.to_site_id;
COMMENT ON VIEW reporting.transfers IS 'Items sent between depots and whether they have arrived, for Power BI and Excel.';
COMMENT ON COLUMN reporting.transfers.transfer_id IS 'Transfer id (movements.transfers.id).';
COMMENT ON COLUMN reporting.transfers.from_site_code IS 'The sending depot.';
COMMENT ON COLUMN reporting.transfers.to_site_code IS 'The receiving depot.';
COMMENT ON COLUMN reporting.transfers.asset_number IS 'The item''s asset number.';
COMMENT ON COLUMN reporting.transfers.kind_name IS 'The item''s kind.';
COMMENT ON COLUMN reporting.transfers.carrier IS 'Who or what carried it.';
COMMENT ON COLUMN reporting.transfers.expected_on IS 'The date it was expected.';
COMMENT ON COLUMN reporting.transfers.sent_at IS 'When it was sent (UTC).';
COMMENT ON COLUMN reporting.transfers.status IS 'in_transit, received or cancelled.';
COMMENT ON COLUMN reporting.transfers.closed_at IS 'When it was received or cancelled (UTC).';

CREATE VIEW reporting.stocktakes AS
  SELECT st.id AS stocktake_id, s.code AS site_code, l.code AS location_code, st.status, st.started_at,
         st.closed_at, st.expected_count, st.found_count, st.not_found_count, st.unexpected_count
    FROM movements.stocktakes st
    JOIN core.sites s ON s.id = st.site_id
    JOIN core.locations l ON l.id = st.location_id;
COMMENT ON VIEW reporting.stocktakes IS 'Every stocktake of a location and what it found, for Power BI and Excel.';
COMMENT ON COLUMN reporting.stocktakes.stocktake_id IS 'Stocktake id (movements.stocktakes.id).';
COMMENT ON COLUMN reporting.stocktakes.site_code IS 'The depot.';
COMMENT ON COLUMN reporting.stocktakes.location_code IS 'The location counted.';
COMMENT ON COLUMN reporting.stocktakes.status IS 'counting or closed.';
COMMENT ON COLUMN reporting.stocktakes.started_at IS 'When counting began (UTC).';
COMMENT ON COLUMN reporting.stocktakes.closed_at IS 'When it was closed (UTC).';
COMMENT ON COLUMN reporting.stocktakes.expected_count IS 'Items expected at the location.';
COMMENT ON COLUMN reporting.stocktakes.found_count IS 'Expected items that were scanned.';
COMMENT ON COLUMN reporting.stocktakes.not_found_count IS 'Expected items that were not scanned.';
COMMENT ON COLUMN reporting.stocktakes.unexpected_count IS 'Items scanned that were not expected there.';

GRANT SELECT ON reporting.movements, reporting.transfers, reporting.stocktakes TO northkit_readonly;
REVOKE ALL ON reporting.movements, reporting.transfers, reporting.stocktakes FROM northkit_app;
