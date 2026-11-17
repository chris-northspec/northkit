-- Sprint 2: the item register (kinds and their inspection rules, items, kit sets, photos,
-- asset-number counters and spreadsheet imports). Schema `register` (DB-02).
--
-- Kinds and their rules are organisation-wide (one organisation per install). Items and
-- photos are site-owned: `site_id` is the item's home depot, with forced RLS (DB-06) and
-- composite (site_id, id) keys, so a kit can only hold items of its own depot and an item
-- can only be in a location of its own depot.
--
-- The kinds' inspection rules are the customer's own schedule settings, editable defaults
-- (ADR 0003). Sprint 2 stores and shows them; schedules and records are Sprint 4.

CREATE SCHEMA register AUTHORIZATION northkit_owner;
COMMENT ON SCHEMA register IS 'The item register: kinds and their inspection rules, items, kit sets, photos, asset-number counters and spreadsheet imports (Sprint 2).';
GRANT USAGE ON SCHEMA register TO northkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner IN SCHEMA register
  GRANT SELECT, INSERT, UPDATE ON TABLES TO northkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE northkit_owner IN SCHEMA register
  GRANT USAGE, SELECT ON SEQUENCES TO northkit_app;

-- ---------------------------------------------------------------- kinds
CREATE TABLE register.kinds (
  id            uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description   text CHECK (length(description) <= 1000),
  asset_prefix  text CHECK (asset_prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES core.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES core.users (id),
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
SELECT public.apply_standard_columns('register.kinds');
SELECT audit.track('register.kinds');
CREATE UNIQUE INDEX kinds_name_unique ON register.kinds (lower(name));
COMMENT ON TABLE register.kinds IS 'Kinds of item (power tool, ladder, harness...) and the inspection rules each carries. Organisation-wide. A kind in use is deactivated, never deleted (the foreign key from items refuses it).';
COMMENT ON COLUMN register.kinds.name IS 'Kind name as staff know it, unique ignoring case.';
COMMENT ON COLUMN register.kinds.description IS 'What the kind covers.';
COMMENT ON COLUMN register.kinds.asset_prefix IS 'Prefix for generated asset numbers of this kind (for example FB gives FB-000123); null uses the organisation default prefix setting.';
COMMENT ON COLUMN register.kinds.active IS 'False once deactivated: no new items of this kind, existing ones stay.';
GRANT DELETE ON register.kinds TO northkit_app;

CREATE TABLE register.kind_rules (
  id             uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  kind_id        uuid NOT NULL REFERENCES register.kinds (id) ON DELETE CASCADE,
  rule_type      text NOT NULL CHECK (rule_type IN ('loler', 'puwer', 'pat', 'calibration', 'pre_use', 'other')),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 100),
  interval_value integer NOT NULL CHECK (interval_value BETWEEN 1 AND 1200),
  interval_unit  text NOT NULL CHECK (interval_unit IN ('days', 'months')),
  required       boolean NOT NULL DEFAULT false,
  note           text CHECK (length(note) <= 1000),
  sort_order     integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES core.users (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES core.users (id),
  row_version    integer NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
SELECT public.apply_standard_columns('register.kind_rules');
SELECT audit.track('register.kind_rules');
CREATE INDEX kind_rules_kind ON register.kind_rules (kind_id, sort_order);
COMMENT ON TABLE register.kind_rules IS 'The inspection rules a kind carries: the customer''s own schedule settings, editable defaults, not legal advice. Sprint 4 builds schedules from them; Sprint 2 stores and shows them. Removing a rule deletes the row (audited).';
COMMENT ON COLUMN register.kind_rules.kind_id IS 'Kind the rule belongs to.';
COMMENT ON COLUMN register.kind_rules.rule_type IS 'loler (thorough examination), puwer (inspection), pat (portable appliance test), calibration, pre_use (user check before use) or other.';
COMMENT ON COLUMN register.kind_rules.title IS 'What the rule is called on screens, for example "Thorough examination".';
COMMENT ON COLUMN register.kind_rules.interval_value IS 'How many days or months between occurrences.';
COMMENT ON COLUMN register.kind_rules.interval_unit IS 'days or months.';
COMMENT ON COLUMN register.kind_rules.required IS 'True if the customer treats the rule as required for this kind.';
COMMENT ON COLUMN register.kind_rules.note IS 'Why the default is what it is and who should confirm it (a competent person).';
COMMENT ON COLUMN register.kind_rules.sort_order IS 'Display order, lowest first.';
GRANT DELETE ON register.kind_rules TO northkit_app;

-- Starter kinds and defaults. Every default is editable and marked for confirmation with a
-- competent person; none is stated as the legal interval (docs/research/compliance-sources.md).
INSERT INTO register.kinds (name, description, asset_prefix) VALUES
  ('Power tool', 'Drills, saws, grinders and other powered hand tools.', 'PT'),
  ('Lifting gear', 'Slings, chain blocks, hoists, shackles and other lifting accessories.', 'LG'),
  ('Access equipment', 'Podium steps, tower sections, trestles and other working platforms.', 'AE'),
  ('Ladder', 'Ladders and stepladders.', 'LD'),
  ('Harness', 'Harnesses, lanyards and fall-arrest kit.', 'FB'),
  ('PAT item', 'Portable electrical equipment tested as a portable appliance: reels, transformers, heaters, lights.', 'PA'),
  ('Test instrument', 'Meters and testers whose readings people rely on.', 'TI'),
  ('Plant', 'Generators, compactors, mixers and other plant.', 'PL');

INSERT INTO register.kind_rules (kind_id, rule_type, title, interval_value, interval_unit, required, note, sort_order)
SELECT k.id, r.rule_type, r.title, r.interval_value, r.interval_unit, r.required, r.note, r.sort_order
  FROM register.kinds k
  JOIN (VALUES
    ('Power tool', 'pre_use', 'Pre-use check', 1, 'days', true, 'A quick user check before use, such as the cable and guards. Your own setting.', 1),
    ('Power tool', 'puwer', 'Inspection', 12, 'months', false, 'Your own schedule setting. HSE leaves frequency to risk assessment and the maker''s advice: confirm with a competent person.', 2),
    ('Power tool', 'pat', 'PAT test', 12, 'months', false, 'Risk-based: HSE does not require annual PAT. Set the interval your competent person recommends.', 3),
    ('Lifting gear', 'pre_use', 'Pre-use check', 1, 'days', true, 'A quick user check before each lift. Your own setting.', 1),
    ('Lifting gear', 'loler', 'Thorough examination', 6, 'months', true, 'LOLER guidance gives 6 months for lifting accessories and equipment lifting people, 12 months for other lifting equipment, unless a written examination scheme says otherwise. Confirm with a competent person. A competent person does the examination; NorthKit stores their report.', 2),
    ('Access equipment', 'pre_use', 'Pre-use check', 1, 'days', true, 'A quick user check before use. Your own setting.', 1),
    ('Access equipment', 'puwer', 'Inspection', 6, 'months', true, 'HSE sets no period for most access equipment; this is your own schedule setting. Follow the maker''s instructions and confirm with a competent person.', 2),
    ('Access equipment', 'loler', 'Thorough examination', 12, 'months', false, 'Only if the equipment lifts people or LOLER otherwise applies. Confirm with a competent person.', 3),
    ('Ladder', 'pre_use', 'Pre-use check', 1, 'days', true, 'HSE describes a daily user check, usually not recorded. Your own setting.', 1),
    ('Ladder', 'puwer', 'Detailed visual inspection', 6, 'months', true, 'HSE says a competent person inspects at fixed intervals but sets no period; this is your own schedule setting.', 2),
    ('Harness', 'pre_use', 'Pre-use check', 1, 'days', true, 'A quick user check before use. Your own setting.', 1),
    ('Harness', 'other', 'Thorough examination', 6, 'months', true, 'Follow the maker''s instructions. HSE gives no figure for harnesses; 6 months is a common industry practice, not an HSE rule. Confirm with a competent person.', 2),
    ('PAT item', 'pre_use', 'User check', 1, 'days', false, 'A quick check of the plug, cable and casing before use. Your own setting.', 1),
    ('PAT item', 'pat', 'PAT test', 12, 'months', true, 'Risk-based: HSE does not require annual PAT. Set the interval your competent person recommends for this kind of kit and where it is used.', 2),
    ('Test instrument', 'pre_use', 'Pre-use check', 1, 'days', true, 'Check leads and probes before use. Your own setting.', 1),
    ('Test instrument', 'calibration', 'Calibration', 12, 'months', true, 'HSE sets no calibration period. Annual calibration and the maker''s recommendation are common practice. Confirm with a competent person.', 2),
    ('Plant', 'pre_use', 'Pre-use check', 1, 'days', true, 'A quick user check before use. Your own setting.', 1),
    ('Plant', 'puwer', 'Inspection', 12, 'months', true, 'Your own schedule setting; frequency comes from risk assessment and the maker''s advice. Confirm with a competent person.', 2),
    ('Plant', 'loler', 'Thorough examination', 12, 'months', false, 'Only if the plant lifts or LOLER otherwise applies. Confirm with a competent person.', 3)
  ) AS r (kind_name, rule_type, title, interval_value, interval_unit, required, note, sort_order)
    ON r.kind_name = k.name;

-- ---------------------------------------------------------------- asset numbers
-- One counter per prefix. A generated number is PREFIX-000123; typed numbers are unique too.
CREATE TABLE register.asset_counters (
  id          uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  prefix      text NOT NULL UNIQUE CHECK (prefix ~ '^[A-Z][A-Z0-9]{0,7}$'),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
COMMENT ON TABLE register.asset_counters IS 'The last generated asset number for each prefix, so generated numbers never repeat. Bookkeeping: changes are not audited, the number shows on the item that took it.';
COMMENT ON COLUMN register.asset_counters.id IS 'Row id, a UUIDv7.';
COMMENT ON COLUMN register.asset_counters.prefix IS 'Asset-number prefix, upper-case letters and digits.';
COMMENT ON COLUMN register.asset_counters.last_number IS 'The highest number issued for the prefix.';

CREATE FUNCTION register.next_asset_number(p_prefix text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  LOOP
    INSERT INTO register.asset_counters AS c (prefix, last_number) VALUES (p_prefix, 1)
      ON CONFLICT (prefix) DO UPDATE SET last_number = c.last_number + 1
      RETURNING last_number INTO n;
    -- Skip any number already typed in by hand.
    EXIT WHEN NOT EXISTS (SELECT FROM register.items WHERE upper(asset_number) = p_prefix || '-' || lpad(n::text, 6, '0'));
  END LOOP;
  RETURN p_prefix || '-' || lpad(n::text, 6, '0');
END
$$;
ALTER FUNCTION register.next_asset_number(text) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION register.next_asset_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.next_asset_number(text) TO northkit_app;
COMMENT ON FUNCTION register.next_asset_number(text) IS 'Returns the next unused generated asset number for a prefix, such as FB-000123. Runs as the owner so it sees every depot''s numbers; reveals nothing else.';

-- ---------------------------------------------------------------- items
CREATE TABLE register.items (
  id              uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id         uuid NOT NULL REFERENCES core.sites (id),
  kind_id         uuid NOT NULL REFERENCES register.kinds (id) ON DELETE RESTRICT,
  asset_number    text NOT NULL CHECK (asset_number ~ '^[A-Z0-9][A-Z0-9._/-]{0,29}$'),
  serial_number   text CHECK (length(serial_number) <= 100),
  make            text CHECK (length(make) <= 100),
  model           text CHECK (length(model) <= 100),
  description     text CHECK (length(description) <= 1000),
  purchase_date   date,
  cost_pence      bigint CHECK (cost_pence >= 0),
  ownership       text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned', 'hired_in')),
  hire_company    text CHECK (length(hire_company) <= 200),
  hire_reference  text CHECK (length(hire_reference) <= 100),
  off_hire_date   date,
  location_id     uuid,
  status          text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'out', 'quarantined', 'missing', 'retired')),
  retired_at      timestamptz,
  retired_reason  text CHECK (length(retired_reason) <= 500),
  is_kit          boolean NOT NULL DEFAULT false,
  parent_id       uuid,
  label_version   smallint NOT NULL DEFAULT 1 CHECK (label_version BETWEEN 1 AND 32000),
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  notes           text CHECK (length(notes) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES core.users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES core.users (id),
  row_version     integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (site_id, id),
  -- Hire details only for hired-in kit, and a hired-in item names its company.
  CONSTRAINT items_hire_details CHECK (
    (ownership = 'hired_in' AND hire_company IS NOT NULL)
    OR (ownership = 'owned' AND hire_company IS NULL AND hire_reference IS NULL AND off_hire_date IS NULL)),
  -- A retired item says when and why; nothing else carries them.
  CONSTRAINT items_retired CHECK (
    (status = 'retired' AND retired_at IS NOT NULL AND retired_reason IS NOT NULL)
    OR (status <> 'retired' AND retired_at IS NULL AND retired_reason IS NULL)),
  CONSTRAINT items_not_own_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT items_kit_not_child CHECK (NOT (is_kit AND parent_id IS NOT NULL)),
  -- The location and the kit must be at the item's own depot.
  FOREIGN KEY (site_id, location_id) REFERENCES core.locations (site_id, id),
  FOREIGN KEY (site_id, parent_id) REFERENCES register.items (site_id, id)
);
SELECT public.apply_standard_columns('register.items');
SELECT public.enable_site_isolation('register.items');
SELECT audit.track('register.items');
CREATE UNIQUE INDEX items_asset_number_unique ON register.items (upper(asset_number));
CREATE INDEX items_site_status ON register.items (site_id, status);
CREATE INDEX items_kind ON register.items (kind_id);
CREATE INDEX items_location ON register.items (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX items_parent ON register.items (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX items_search ON register.items (site_id, lower(asset_number), lower(coalesce(make, '')), lower(coalesce(model, '')));
CREATE INDEX items_attributes ON register.items USING gin (attributes);
COMMENT ON TABLE register.items IS 'Every tool and piece of equipment the organisation owns or has hired in. Site-owned (home depot). Retired, never deleted. A kit (is_kit) holds items one level deep.';
COMMENT ON COLUMN register.items.kind_id IS 'Kind of item; its inspection rules come from the kind.';
COMMENT ON COLUMN register.items.asset_number IS 'The number on the label, unique across the organisation ignoring case. Generated (PREFIX-000123) or typed in.';
COMMENT ON COLUMN register.items.serial_number IS 'Maker''s serial number, as printed.';
COMMENT ON COLUMN register.items.make IS 'Maker.';
COMMENT ON COLUMN register.items.model IS 'Model.';
COMMENT ON COLUMN register.items.description IS 'What the item is, in plain words.';
COMMENT ON COLUMN register.items.purchase_date IS 'Date bought; null if unknown.';
COMMENT ON COLUMN register.items.cost_pence IS 'Purchase cost in whole pence (exact: never a float); null if unknown.';
COMMENT ON COLUMN register.items.ownership IS 'owned, or hired_in from another company.';
COMMENT ON COLUMN register.items.hire_company IS 'Company the item is hired from; required when hired in, empty when owned.';
COMMENT ON COLUMN register.items.hire_reference IS 'The hire company''s agreement or contract reference.';
COMMENT ON COLUMN register.items.off_hire_date IS 'Date the item is due to go back to the hire company.';
COMMENT ON COLUMN register.items.location_id IS 'Where the item is now (a store, van, yard or job site of the same depot); null if not placed yet.';
COMMENT ON COLUMN register.items.status IS 'available, out, quarantined, missing or retired. Transitions are enforced by a trigger; Sprint 2 sets only available and retired, later sprints set the rest.';
COMMENT ON COLUMN register.items.retired_at IS 'When the item was retired; set with retired_reason.';
COMMENT ON COLUMN register.items.retired_reason IS 'Why the item was retired (sold, scrapped, failed beyond repair...).';
COMMENT ON COLUMN register.items.is_kit IS 'True if the item is a kit (a harness set) that holds other items. A kit can''t itself be inside a kit.';
COMMENT ON COLUMN register.items.parent_id IS 'The kit this item is part of, in the same depot; null if it is not in a kit. Kits are one level deep.';
COMMENT ON COLUMN register.items.label_version IS 'Version of the label code: replacing a lost or copied label adds one, so every older print stops working.';
COMMENT ON COLUMN register.items.attributes IS 'Kind-specific details (a ladder''s rated height, a sling''s working load limit) as a JSON object (DB-16).';
COMMENT ON COLUMN register.items.notes IS 'Free-text notes.';

-- New items need an active kind (an existing item keeps a kind deactivated later).
CREATE FUNCTION register.check_item_kind() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.kind_id IS DISTINCT FROM OLD.kind_id)
     AND NOT EXISTS (SELECT FROM register.kinds WHERE id = NEW.kind_id AND active) THEN
    RAISE EXCEPTION 'That kind is deactivated: choose an active kind.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'items_kind_active';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION register.check_item_kind() IS 'Trigger: refuses a new item (or a change of kind) to a deactivated kind.';
CREATE TRIGGER check_item_kind BEFORE INSERT OR UPDATE OF kind_id ON register.items
  FOR EACH ROW EXECUTE FUNCTION register.check_item_kind();

-- Status transitions (ready for the Sprint 4 quarantine rule). retired is final.
CREATE FUNCTION register.check_item_status() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'available' AND NEW.status IN ('out', 'quarantined', 'missing', 'retired'))
    OR (OLD.status = 'out' AND NEW.status IN ('available', 'quarantined', 'missing'))
    OR (OLD.status = 'quarantined' AND NEW.status IN ('available', 'missing', 'retired'))
    OR (OLD.status = 'missing' AND NEW.status IN ('available', 'retired'))) THEN
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
COMMENT ON FUNCTION register.check_item_status() IS 'Trigger: only allowed status changes get through (available to out, quarantined, missing or retired; out back to available, or to quarantined or missing; quarantined or missing back to available or on to retired). A kit that still holds live items can''t be retired.';
CREATE TRIGGER check_item_status BEFORE UPDATE OF status ON register.items
  FOR EACH ROW EXECUTE FUNCTION register.check_item_status();

-- Kits are one level deep: the parent is a kit with no parent of its own, and a kit that
-- holds items can't become part of another kit.
CREATE FUNCTION register.check_kit() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT FROM register.items p WHERE p.id = NEW.parent_id AND p.is_kit AND p.parent_id IS NULL) THEN
      RAISE EXCEPTION 'Items can only be put in a kit.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'items_parent_is_kit';
    END IF;
    IF NEW.is_kit THEN
      RAISE EXCEPTION 'A kit can''t be inside another kit.'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'items_kit_not_child';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_kit AND NOT NEW.is_kit
     AND EXISTS (SELECT FROM register.items c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'Take the items out of this kit before turning it into a single item.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'items_kit_has_items';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION register.check_kit() IS 'Trigger: kits are one level deep. The parent must be a kit that is not itself in a kit, and a kit holding items can''t be turned into a single item.';
CREATE TRIGGER check_kit BEFORE INSERT OR UPDATE OF parent_id, is_kit ON register.items
  FOR EACH ROW EXECUTE FUNCTION register.check_kit();

-- ---------------------------------------------------------------- photos
CREATE TABLE register.item_photos (
  id            uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id       uuid NOT NULL REFERENCES core.sites (id),
  item_id       uuid NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size     integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key   text NOT NULL CHECK (storage_key ~ '^items/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  thumb_key     text CHECK (thumb_key ~ '^items/[0-9a-f-]{36}/[0-9a-f-]{36}\.thumb\.jpg$'),
  thumb_failed  boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES core.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES core.users (id),
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (site_id, id),
  FOREIGN KEY (site_id, item_id) REFERENCES register.items (site_id, id)
);
SELECT public.apply_standard_columns('register.item_photos');
SELECT public.enable_site_isolation('register.item_photos');
SELECT audit.track('register.item_photos');
CREATE INDEX item_photos_item ON register.item_photos (item_id, sort_order);
COMMENT ON TABLE register.item_photos IS 'Photos of items (not of people), at most 10 per item. The file is on the files volume with its metadata (EXIF, GPS) stripped; it is served only through a permission check. Removing a photo deletes the row (audited).';
COMMENT ON COLUMN register.item_photos.item_id IS 'Item photographed, in the same depot.';
COMMENT ON COLUMN register.item_photos.content_type IS 'image/jpeg, image/png or image/webp, decided from the file''s bytes, never its name.';
COMMENT ON COLUMN register.item_photos.byte_size IS 'Stored size in bytes after metadata was stripped; at most 10 MB.';
COMMENT ON COLUMN register.item_photos.width IS 'Width in pixels.';
COMMENT ON COLUMN register.item_photos.height IS 'Height in pixels.';
COMMENT ON COLUMN register.item_photos.sha256 IS 'SHA-256 of the stored file, so a download can be checked.';
COMMENT ON COLUMN register.item_photos.storage_key IS 'Where the file is under the files directory.';
COMMENT ON COLUMN register.item_photos.thumb_key IS 'Where the thumbnail is; null until the worker has made it (the page shows the full photo meanwhile).';
COMMENT ON COLUMN register.item_photos.thumb_failed IS 'True if the worker could not make a thumbnail (a WebP, or a file it could not decode); the page then shows the stored photo.';
COMMENT ON COLUMN register.item_photos.sort_order IS 'Display order, lowest first; the first is the item''s main photo.';
GRANT DELETE ON register.item_photos TO northkit_app;

CREATE FUNCTION register.limit_item_photos() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Lock the item so two uploads at once can't both take the tenth place.
  PERFORM 1 FROM register.items WHERE id = NEW.item_id FOR UPDATE;
  IF (SELECT count(*) FROM register.item_photos WHERE item_id = NEW.item_id) >= 10 THEN
    RAISE EXCEPTION 'An item can have at most 10 photos.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'item_photos_max';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION register.limit_item_photos() IS 'Trigger: at most 10 photos per item, safe against two uploads at once.';
CREATE TRIGGER limit_item_photos BEFORE INSERT ON register.item_photos
  FOR EACH ROW EXECUTE FUNCTION register.limit_item_photos();

-- The worker has no user scope, so it reaches photos through two narrow owner-run
-- functions: find the ones waiting for a thumbnail, and record the result.
CREATE FUNCTION register.photos_awaiting_thumbnail(p_limit integer)
RETURNS TABLE (id uuid, site_id uuid, storage_key text, content_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.id, p.site_id, p.storage_key, p.content_type
    FROM register.item_photos p
   WHERE p.thumb_key IS NULL AND NOT p.thumb_failed
   ORDER BY p.created_at
   LIMIT least(greatest(p_limit, 1), 100);
$$;
ALTER FUNCTION register.photos_awaiting_thumbnail(integer) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION register.photos_awaiting_thumbnail(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.photos_awaiting_thumbnail(integer) TO northkit_app;
COMMENT ON FUNCTION register.photos_awaiting_thumbnail(integer) IS 'For the worker: photos that have no thumbnail yet and have not failed, oldest first. Reveals only ids, keys and types.';

CREATE FUNCTION register.record_photo_thumbnail(p_id uuid, p_key text) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE register.item_photos
     SET thumb_key = p_key, thumb_failed = (p_key IS NULL)
   WHERE id = p_id AND thumb_key IS NULL;
$$;
ALTER FUNCTION register.record_photo_thumbnail(uuid, text) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION register.record_photo_thumbnail(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.record_photo_thumbnail(uuid, text) TO northkit_app;
COMMENT ON FUNCTION register.record_photo_thumbnail(uuid, text) IS 'For the worker: records the thumbnail made for a photo, or (with a null key) that none could be made.';

-- A scan with no login (S2-4): the one thing anyone can learn from a label is the item's
-- kind and asset number, and only when the code's version is the item's current one.
CREATE FUNCTION register.resolve_label(p_item_id uuid, p_version smallint)
RETURNS TABLE (asset_number text, kind_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT i.asset_number, k.name
    FROM register.items i JOIN register.kinds k ON k.id = i.kind_id
   WHERE i.id = p_item_id AND i.label_version = p_version;
$$;
ALTER FUNCTION register.resolve_label(uuid, smallint) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION register.resolve_label(uuid, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.resolve_label(uuid, smallint) TO northkit_app;
COMMENT ON FUNCTION register.resolve_label(uuid, smallint) IS 'For the no-login scan page: the asset number and kind of the item a label names, if the label version is current. Reveals nothing else, so a forged code and an old label get the same answer.';

-- For the import check: which of these asset numbers are already used anywhere in the
-- organisation (the caller can't see other depots' rows, but a duplicate must be caught).
CREATE FUNCTION register.asset_numbers_taken(p_numbers text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(array_agg(upper(asset_number)), '{}')
    FROM register.items WHERE upper(asset_number) = ANY (SELECT upper(unnest(p_numbers)));
$$;
ALTER FUNCTION register.asset_numbers_taken(text[]) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION register.asset_numbers_taken(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register.asset_numbers_taken(text[]) TO northkit_app;
COMMENT ON FUNCTION register.asset_numbers_taken(text[]) IS 'For the import check: which of the given asset numbers are already used, in any depot. Reveals only that a number is taken.';

-- ---------------------------------------------------------------- imports
-- A spreadsheet import: the file on the files volume, the check report and the outcome.
-- All or nothing: items are stored only when the whole file is clean.
CREATE TABLE register.imports (
  id            uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  file_format   text NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  stored_name   text NOT NULL CHECK (stored_name ~ '^[0-9a-f-]{36}\.(csv|xlsx)$'),
  byte_size     integer NOT NULL CHECK (byte_size > 0),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'checking', 'problems', 'ready', 'loading', 'loaded', 'failed')),
  row_count     integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  items_loaded  integer NOT NULL DEFAULT 0 CHECK (items_loaded >= 0),
  report        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report) = 'object'),
  error         text CHECK (length(error) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES core.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES core.users (id),
  row_version   integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CONSTRAINT imports_loaded_count CHECK (status = 'loaded' OR items_loaded = 0)
);
SELECT public.apply_standard_columns('register.imports');
SELECT audit.track('register.imports');
CREATE INDEX imports_queue ON register.imports (created_at) WHERE status IN ('queued', 'loading');
COMMENT ON TABLE register.imports IS 'Spreadsheet imports of items. Organisation-level: the service lets a person see their own imports and Kit Managers all of them. The check report lists every problem by row and column; items are stored only when nothing is wrong.';
COMMENT ON COLUMN register.imports.file_name IS 'The uploaded file''s name, for display only.';
COMMENT ON COLUMN register.imports.file_format IS 'csv or xlsx, decided from the file.';
COMMENT ON COLUMN register.imports.stored_name IS 'Where the file is under the files directory (imports/).';
COMMENT ON COLUMN register.imports.byte_size IS 'Size of the uploaded file in bytes.';
COMMENT ON COLUMN register.imports.status IS 'queued (waiting for the worker or a check), checking, problems (the file has errors; nothing stored), ready (clean, waiting to be stored), loading, loaded or failed.';
COMMENT ON COLUMN register.imports.row_count IS 'Rows read, not counting the header.';
COMMENT ON COLUMN register.imports.items_loaded IS 'Items stored; 0 unless loaded.';
COMMENT ON COLUMN register.imports.report IS 'The check report: file-level problems and problems by row and column.';
COMMENT ON COLUMN register.imports.error IS 'Why the import failed (a fault, not a problem in the file).';

-- ---------------------------------------------------------------- settings
INSERT INTO core.settings (key, value, description) VALUES
  ('items.asset_number_prefix', '"KIT"',
   'Prefix for generated asset numbers when the item''s kind has none (for example KIT gives KIT-000123).');

-- ---------------------------------------------------------------- reporting
CREATE VIEW reporting.items AS
SELECT i.id AS item_id, s.code AS site_code, i.asset_number, k.name AS kind_name, i.serial_number, i.make, i.model,
       i.purchase_date, i.cost_pence, i.ownership, i.hire_company, i.off_hire_date, l.code AS location_code,
       i.status, p.asset_number AS kit_asset_number, i.created_at
  FROM register.items i
  JOIN core.sites s ON s.id = i.site_id
  JOIN register.kinds k ON k.id = i.kind_id
  LEFT JOIN core.locations l ON l.id = i.location_id
  LEFT JOIN register.items p ON p.id = i.parent_id;
COMMENT ON VIEW reporting.items IS 'One row per item with its depot, kind, location and kit, for Power BI and Excel.';
COMMENT ON COLUMN reporting.items.item_id IS 'Item id (register.items.id).';
COMMENT ON COLUMN reporting.items.site_code IS 'Home depot reference.';
COMMENT ON COLUMN reporting.items.asset_number IS 'Asset number on the label.';
COMMENT ON COLUMN reporting.items.kind_name IS 'Kind of item.';
COMMENT ON COLUMN reporting.items.serial_number IS 'Maker''s serial number.';
COMMENT ON COLUMN reporting.items.make IS 'Maker.';
COMMENT ON COLUMN reporting.items.model IS 'Model.';
COMMENT ON COLUMN reporting.items.purchase_date IS 'Date bought.';
COMMENT ON COLUMN reporting.items.cost_pence IS 'Purchase cost in pence.';
COMMENT ON COLUMN reporting.items.ownership IS 'owned or hired_in.';
COMMENT ON COLUMN reporting.items.hire_company IS 'Company hired from.';
COMMENT ON COLUMN reporting.items.off_hire_date IS 'Date due back to the hire company.';
COMMENT ON COLUMN reporting.items.location_code IS 'Code of the item''s current location.';
COMMENT ON COLUMN reporting.items.status IS 'available, out, quarantined, missing or retired.';
COMMENT ON COLUMN reporting.items.kit_asset_number IS 'Asset number of the kit the item is in, if any.';
COMMENT ON COLUMN reporting.items.created_at IS 'When the item was registered (UTC).';

CREATE VIEW reporting.kinds AS
SELECT k.id AS kind_id, k.name AS kind_name, k.active, r.rule_type, r.title AS rule_title,
       r.interval_value, r.interval_unit, r.required
  FROM register.kinds k
  LEFT JOIN register.kind_rules r ON r.kind_id = k.id;
COMMENT ON VIEW reporting.kinds IS 'Each kind with its inspection rules (one row per rule), for Power BI and Excel.';
COMMENT ON COLUMN reporting.kinds.kind_id IS 'Kind id.';
COMMENT ON COLUMN reporting.kinds.kind_name IS 'Kind name.';
COMMENT ON COLUMN reporting.kinds.active IS 'False once deactivated.';
COMMENT ON COLUMN reporting.kinds.rule_type IS 'loler, puwer, pat, calibration, pre_use or other; empty if the kind has no rules.';
COMMENT ON COLUMN reporting.kinds.rule_title IS 'Rule name.';
COMMENT ON COLUMN reporting.kinds.interval_value IS 'Days or months between occurrences.';
COMMENT ON COLUMN reporting.kinds.interval_unit IS 'days or months.';
COMMENT ON COLUMN reporting.kinds.required IS 'True if the customer treats the rule as required.';

GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO northkit_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM northkit_app;
