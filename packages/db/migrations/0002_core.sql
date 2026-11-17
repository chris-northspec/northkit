-- Core: the organisation, sites, locations, settings, and people and access (S1-3, S1-4, S1-5).
-- Users, roles, sessions and the access functions are copied from NorthKeep main
-- (commit 944121d, ADR 0002) and adapted: site scope only, roles can require two-factor
-- sign-in (the Administrator always does).
--
-- Site-owned tables (site_id, or core.sites itself) carry RLS through
-- public.enable_site_isolation (DB-06) and composite (site_id, id) keys so a child
-- can never point at a parent in another site.
--
-- A "site" is a depot, branch or yard the organisation runs kit from. "Locations" are the
-- places kit can be: a store, a van, a yard or a job site. Every location belongs to one
-- site (its home depot), so row-level security works the same way everywhere.

-- ---------------------------------------------------------------- users
CREATE TABLE core.users (
  id                    uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  email                 text NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  display_name          text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  phone                 text CHECK (length(phone) <= 40),
  password_hash         text CHECK (password_hash LIKE '$argon2id$%'),
  must_change_password  boolean NOT NULL DEFAULT false,
  mfa_secret_encrypted  text,
  mfa_enabled_at        timestamptz,
  mfa_last_used_step    bigint,
  failed_login_count    integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,
  all_sites             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid,
  row_version           integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  archived_at           timestamptz,
  CHECK (mfa_enabled_at IS NULL OR mfa_secret_encrypted IS NOT NULL),
  FOREIGN KEY (created_by) REFERENCES core.users (id),
  FOREIGN KEY (updated_by) REFERENCES core.users (id)
);
SELECT public.apply_standard_columns('core.users');
CREATE UNIQUE INDEX users_email_unique ON core.users (lower(email));
COMMENT ON TABLE core.users IS 'People who sign in: office staff, kit managers, supervisors, operatives. Organisation-level (not owned by one site); which sites a user can see comes from all_sites, user_sites and their roles. Archived, not deleted.';
COMMENT ON COLUMN core.users.email IS '[personal] Sign-in email address, unique ignoring case.';
COMMENT ON COLUMN core.users.display_name IS '[personal] Name shown on screens and in the audit trail.';
COMMENT ON COLUMN core.users.phone IS '[personal] Contact phone number, as entered.';
COMMENT ON COLUMN core.users.password_hash IS 'Argon2id hash in PHC format. Null means the account cannot sign in with a password. Never logged or audited.';
COMMENT ON COLUMN core.users.must_change_password IS 'True when an admin set the password; the user must choose a new one at next sign-in.';
COMMENT ON COLUMN core.users.mfa_secret_encrypted IS 'TOTP secret, AES-256-GCM encrypted with NORTHKIT_SECRET_KEY. Never logged or audited.';
COMMENT ON COLUMN core.users.mfa_enabled_at IS 'When two-factor sign-in was turned on; null means off.';
COMMENT ON COLUMN core.users.mfa_last_used_step IS 'Last TOTP time step accepted, so the same code cannot be used twice.';
COMMENT ON COLUMN core.users.failed_login_count IS 'Failed sign-ins since the last success or lockout. Five in a row locks the account.';
COMMENT ON COLUMN core.users.locked_until IS 'Sign-in is refused until this time (15 minutes after the fifth failure); null when not locked.';
COMMENT ON COLUMN core.users.last_login_at IS 'Last successful sign-in (UTC).';
COMMENT ON COLUMN core.users.all_sites IS 'True if the user works at every site (organisation-wide staff); otherwise user_sites lists them. Narrowed further by the site scope of their roles.';

-- ---------------------------------------------------------------- organisations
CREATE TABLE core.organisations (
  id                uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  singleton         boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  country_code      char(2) NOT NULL DEFAULT 'GB' CHECK (country_code ~ '^[A-Z]{2}$'),
  default_time_zone text NOT NULL DEFAULT 'Europe/London' CHECK (length(default_time_zone) BETWEEN 1 AND 64),
  trusted_proxies   cidr[] NOT NULL DEFAULT '{}' CHECK (cardinality(trusted_proxies) <= 10),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES core.users (id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES core.users (id),
  row_version       integer NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
SELECT public.apply_standard_columns('core.organisations');
COMMENT ON TABLE core.organisations IS 'The customer running this install: exactly one row, made at first-run set-up. Shown in the header in place of the product name.';
COMMENT ON COLUMN core.organisations.singleton IS 'Always true and unique, so the table can hold only one row.';
COMMENT ON COLUMN core.organisations.name IS 'Organisation name shown in the app header.';
COMMENT ON COLUMN core.organisations.country_code IS 'ISO 3166-1 alpha-2 country code; the default for new sites.';
COMMENT ON COLUMN core.organisations.default_time_zone IS 'IANA time zone offered first for new sites (e.g. Europe/London).';
COMMENT ON COLUMN core.organisations.trusted_proxies IS 'Addresses (or ranges) of the customer''s own reverse proxy, named by an administrator. Empty (default): the connecting address is used for rate limits and X-Forwarded-For is ignored. Only a request arriving from one of these has its forwarded client address believed.';

-- ---------------------------------------------------------------- sites
CREATE TABLE core.sites (
  id               uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  address_line_1   text CHECK (length(address_line_1) <= 200),
  address_line_2   text CHECK (length(address_line_2) <= 200),
  town             text CHECK (length(town) <= 100),
  postcode         text CHECK (length(postcode) <= 20),
  country_code     char(2) NOT NULL DEFAULT 'GB' CHECK (country_code ~ '^[A-Z]{2}$'),
  time_zone        text NOT NULL DEFAULT 'Europe/London' CHECK (length(time_zone) BETWEEN 1 AND 64),
  phone            text CHECK (length(phone) <= 40),
  email            text CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  manager_user_id  uuid REFERENCES core.users (id),
  notes            text CHECK (length(notes) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES core.users (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES core.users (id),
  row_version      integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  archived_at      timestamptz
);
SELECT public.apply_standard_columns('core.sites');
SELECT public.enable_site_isolation('core.sites', 'id');
COMMENT ON TABLE core.sites IS 'Depots, branches and yards the organisation runs kit from. The isolation root: row-level security on id, so a user only sees sites in their scope. Archived, not deleted.';
COMMENT ON COLUMN core.sites.code IS 'Short site reference shown on screens and labels, unique across the install. Upper-case letters, digits, _ and -.';
COMMENT ON COLUMN core.sites.name IS 'Site name as staff know it.';
COMMENT ON COLUMN core.sites.address_line_1 IS 'First line of the site address.';
COMMENT ON COLUMN core.sites.address_line_2 IS 'Second line of the site address.';
COMMENT ON COLUMN core.sites.town IS 'Town or city.';
COMMENT ON COLUMN core.sites.postcode IS 'Postcode, stored as entered.';
COMMENT ON COLUMN core.sites.country_code IS 'ISO 3166-1 alpha-2 country code.';
COMMENT ON COLUMN core.sites.time_zone IS 'IANA time zone (e.g. Europe/London). Times are stored in UTC; due dates and reminders are worked out in this zone.';
COMMENT ON COLUMN core.sites.phone IS 'Main site phone number (a business number, not a person).';
COMMENT ON COLUMN core.sites.email IS 'Main site email address (a shared mailbox, not a person).';
COMMENT ON COLUMN core.sites.manager_user_id IS 'User who manages the site; null if not set.';
COMMENT ON COLUMN core.sites.notes IS 'Free-text notes about the site (access, gate codes held elsewhere, key holders). No personal health details.';

-- A home site per user, for the site filter.
ALTER TABLE core.users ADD COLUMN home_site_id uuid REFERENCES core.sites (id);
COMMENT ON COLUMN core.users.home_site_id IS 'Site the site filter opens on when the browser has no choice remembered; null opens on all the user''s sites. Ignored if the user no longer works there. Set by the user in Account settings (audited).';

-- ---------------------------------------------------------------- locations
-- Where kit can be. A location sits under one site; stores, vans, yards and job sites can
-- also nest (a cage inside a store), so the tree uses ltree as NorthKeep's locations do.
CREATE TABLE core.locations (
  id           uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id      uuid NOT NULL REFERENCES core.sites (id),
  parent_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('site', 'van', 'store', 'yard')),
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  reference    text CHECK (length(reference) <= 100),
  notes        text CHECK (length(notes) <= 2000),
  path         ltree NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES core.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES core.users (id),
  row_version  integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  archived_at  timestamptz,
  UNIQUE (site_id, id),
  UNIQUE (site_id, code),
  CHECK (parent_id IS DISTINCT FROM id),
  -- A parent must be in the same site.
  FOREIGN KEY (site_id, parent_id) REFERENCES core.locations (site_id, id)
);
SELECT public.apply_standard_columns('core.locations');
SELECT public.enable_site_isolation('core.locations');
CREATE INDEX locations_path_gist ON core.locations USING gist (path);
CREATE INDEX locations_parent ON core.locations (parent_id);
CREATE INDEX locations_kind ON core.locations (site_id, kind) WHERE archived_at IS NULL;
CREATE INDEX locations_name_search ON core.locations (site_id, lower(name));
COMMENT ON TABLE core.locations IS 'Places kit can be, per site: a store, a van, a yard or a job site. Items are checked out to and back in from locations. Archived, not deleted.';
COMMENT ON COLUMN core.locations.parent_id IS 'Parent location in the same site (a cage inside a store); null at the top of the tree.';
COMMENT ON COLUMN core.locations.kind IS 'site (a job site or customer premises), van, store or yard.';
COMMENT ON COLUMN core.locations.code IS 'Location code, unique within the site; printed on labels (e.g. VAN-03).';
COMMENT ON COLUMN core.locations.name IS 'Location name as staff know it (e.g. Van 3, Main store).';
COMMENT ON COLUMN core.locations.reference IS 'A vehicle registration, job number or similar, as entered. A registration is not a personal record here: it names the van.';
COMMENT ON COLUMN core.locations.notes IS 'Free-text notes about the location.';
COMMENT ON COLUMN core.locations.path IS 'Materialised path of ids from the top of the tree to this location (ltree). Maintained by trigger; query subtrees with path <@ parent_path.';

-- Keeps path in step with the parent. Ids rather than codes form the path, so renaming
-- a location never touches its descendants. Nested calls (the subtree rewrite below)
-- are skipped: that statement sets the values itself.
CREATE FUNCTION core.set_location_path() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_path ltree;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id IS NULL THEN
    NEW.path := text2ltree(replace(NEW.id::text, '-', ''));
    RETURN NEW;
  END IF;
  SELECT path INTO parent_path FROM core.locations WHERE id = NEW.parent_id;
  IF TG_OP = 'UPDATE' AND parent_path <@ OLD.path THEN
    RAISE EXCEPTION 'A location cannot be moved under itself or one of its own children'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'locations_no_cycle';
  END IF;
  NEW.path := parent_path || text2ltree(replace(NEW.id::text, '-', ''));
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION core.set_location_path() IS 'BEFORE INSERT OR UPDATE trigger: sets locations.path from the parent, and blocks cycles.';

CREATE FUNCTION core.move_location_subtree() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE core.locations
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION core.move_location_subtree() IS 'AFTER UPDATE trigger: when a location moves to a new parent, rewrites the path of every descendant.';

CREATE TRIGGER set_location_path BEFORE INSERT OR UPDATE OF parent_id ON core.locations
  FOR EACH ROW EXECUTE FUNCTION core.set_location_path();
CREATE TRIGGER move_location_subtree AFTER UPDATE OF parent_id ON core.locations
  FOR EACH ROW
  WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION core.move_location_subtree();

-- ---------------------------------------------------------------- settings
-- Organisation-wide settings as key and value. The keys the app understands, and the
-- values each accepts, are listed in packages/core/src/services/settings.ts; the
-- database only guarantees the shape.
CREATE TABLE core.settings (
  id           uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  key          text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  value        jsonb NOT NULL,
  description  text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES core.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES core.users (id),
  row_version  integer NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
SELECT public.apply_standard_columns('core.settings');
COMMENT ON TABLE core.settings IS 'Organisation-wide settings as key and value (e.g. reminder days). Changed by an Administrator and audited. One row per key.';
COMMENT ON COLUMN core.settings.key IS 'Dotted lower-case name, e.g. reminders.days_before_due.';
COMMENT ON COLUMN core.settings.value IS 'The setting, as JSON. Checked by the app against the key.';
COMMENT ON COLUMN core.settings.description IS 'What the setting does, in plain words.';

INSERT INTO core.settings (key, value, description) VALUES
  ('reminders.days_before_due', '[30, 14, 3]',
   'How many days before an inspection or certificate falls due a reminder is sent. Used from Sprint 4.'),
  ('checkout.default_days_out', '7',
   'How many days kit may be out before it counts as overdue, when no due-back date is given. Used from Sprint 3.'),
  ('session.timeout_warning_minutes', '2',
   'How many minutes before a session ends for being idle the sign-in timeout warning appears.');

-- ---------------------------------------------------------------- permissions and roles
-- Nine areas by four actions. "approve" is the sign-off step of the area: clearing a
-- quarantined item after a passed inspection, writing off lost kit, and so on.
CREATE FUNCTION core.permission_codes() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT array_agg(a || '.' || x ORDER BY ai, xi)
    FROM unnest(ARRAY['overview', 'locations', 'items', 'checkouts', 'inspections', 'imports',
                      'reports', 'users', 'settings']) WITH ORDINALITY AS areas (a, ai)
   CROSS JOIN unnest(ARRAY['view', 'create', 'edit', 'approve']) WITH ORDINALITY AS actions (x, xi);
$$;
COMMENT ON FUNCTION core.permission_codes() IS 'Every permission code, area.action: nine areas by four actions (view, create, edit, approve). Mirrors packages/core/src/auth/permissions.ts; change both together.';

CREATE TABLE core.roles (
  id           uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description  text CHECK (length(description) <= 500),
  permissions  text[] NOT NULL DEFAULT '{}',
  full_access  boolean NOT NULL DEFAULT false,
  site_scope   text NOT NULL DEFAULT 'all' CHECK (site_scope IN ('all', 'listed')),
  requires_mfa boolean NOT NULL DEFAULT false,
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES core.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES core.users (id),
  row_version  integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  archived_at  timestamptz,
  CONSTRAINT roles_permissions_known CHECK (permissions <@ core.permission_codes()),
  CONSTRAINT roles_full_access_is_admin CHECK (full_access = (code = 'admin')),
  CONSTRAINT roles_admin_requires_mfa CHECK (NOT full_access OR requires_mfa)
);
SELECT public.apply_standard_columns('core.roles');
CREATE UNIQUE INDEX roles_name_unique ON core.roles (lower(name)) WHERE archived_at IS NULL;
COMMENT ON TABLE core.roles IS 'Named sets of on/off permissions (area x View/Create/Edit/Approve) with a site scope. Organisation-wide. Seeded roles are editable defaults, except the locked Administrator.';
COMMENT ON COLUMN core.roles.code IS 'Role code used in code and tests, unique.';
COMMENT ON COLUMN core.roles.name IS 'Role name shown to admins, unique among live roles ignoring case.';
COMMENT ON COLUMN core.roles.description IS 'What the role is for.';
COMMENT ON COLUMN core.roles.permissions IS 'Permission codes granted, area.action (e.g. items.edit). Must be in core.permission_codes(). Ignored for the full-access Administrator role.';
COMMENT ON COLUMN core.roles.full_access IS 'True only for the locked Administrator role: every permission at every site, whatever else the row says. It can''t be edited or archived.';
COMMENT ON COLUMN core.roles.site_scope IS 'all: the role works at every site the user is assigned; listed: only the sites in role_sites.';
COMMENT ON COLUMN core.roles.requires_mfa IS 'True if holders must turn on two-factor sign-in before they can do anything else. Always true for the Administrator.';
COMMENT ON COLUMN core.roles.is_system IS 'True for the roles shipped with the product. They can be edited, except the Administrator, but not archived.';

INSERT INTO core.roles (code, name, description, permissions, full_access, site_scope, requires_mfa, is_system) VALUES
  ('admin', 'Administrator',
   'Always full access to every area and site, including settings, roles, licence and data export. Locked; two-factor sign-in required; at least one active administrator must exist.',
   core.permission_codes(), true, 'all', true, true),
  ('kit_manager', 'Kit Manager',
   'Runs the register: items, locations, check-out and in, inspections, imports and reports at every site the user is assigned. Clears quarantined kit after a passed inspection.',
   ARRAY[
     'overview.view',
     'locations.view', 'locations.create', 'locations.edit',
     'items.view', 'items.create', 'items.edit', 'items.approve',
     'checkouts.view', 'checkouts.create', 'checkouts.edit', 'checkouts.approve',
     'inspections.view', 'inspections.create', 'inspections.edit', 'inspections.approve',
     'imports.view', 'imports.create',
     'reports.view', 'reports.create',
     'users.view'],
   false, 'all', false, true),
  ('supervisor', 'Supervisor',
   'Runs a depot, crew or job: sees the register, issues and receives kit for the team, records inspections and pre-use checks.',
   ARRAY[
     'overview.view',
     'locations.view',
     'items.view', 'items.edit',
     'checkouts.view', 'checkouts.create', 'checkouts.edit',
     'inspections.view', 'inspections.create',
     'reports.view'],
   false, 'all', false, true),
  ('operative', 'Operative',
   'Phone-first: checks kit out and in and does pre-use checks. Nothing else.',
   ARRAY[
     'overview.view',
     'items.view',
     'checkouts.view', 'checkouts.create',
     'inspections.view', 'inspections.create'],
   false, 'all', false, true),
  ('viewer', 'Viewer',
   'Read-only: overview, locations, items, check-outs, inspections and reports.',
   ARRAY[
     'overview.view', 'locations.view', 'items.view', 'checkouts.view', 'inspections.view', 'reports.view'],
   false, 'all', false, true);

-- The Administrator role is locked: nothing that matters can change, and it can't go.
CREATE FUNCTION core.refuse_admin_role_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['updated_at', 'updated_by', 'row_version'])
                         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'updated_by', 'row_version']) THEN
    RAISE EXCEPTION 'The Administrator role is locked and can''t be changed.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_admin_locked';
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION core.refuse_admin_role_change() IS 'Trigger keeping the full-access Administrator role exactly as seeded.';
CREATE TRIGGER admin_role_locked BEFORE UPDATE OR DELETE ON core.roles
  FOR EACH ROW WHEN (OLD.full_access) EXECUTE FUNCTION core.refuse_admin_role_change();

-- ---------------------------------------------------------------- user_roles, user_sites, role_sites
CREATE TABLE core.user_roles (
  id          uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  user_id     uuid NOT NULL REFERENCES core.users (id),
  role_id     uuid NOT NULL REFERENCES core.roles (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES core.users (id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (user_id, role_id)
);
SELECT public.apply_standard_columns('core.user_roles');
CREATE INDEX user_roles_role ON core.user_roles (role_id);
COMMENT ON TABLE core.user_roles IS 'Roles held by each user. Removing a role deletes the row (audited).';
COMMENT ON COLUMN core.user_roles.user_id IS 'User holding the role.';
COMMENT ON COLUMN core.user_roles.role_id IS 'Role held.';

CREATE TABLE core.user_sites (
  id          uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id     uuid NOT NULL REFERENCES core.sites (id),
  user_id     uuid NOT NULL REFERENCES core.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES core.users (id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (user_id, site_id)
);
SELECT public.apply_standard_columns('core.user_sites');
SELECT public.enable_site_isolation('core.user_sites');
CREATE INDEX user_sites_site ON core.user_sites (site_id);
COMMENT ON TABLE core.user_sites IS 'Sites a user works at when users.all_sites is false; builds their app.site_ids scope with their roles. Removing a site deletes the row (audited).';
COMMENT ON COLUMN core.user_sites.user_id IS 'User assigned.';

CREATE TABLE core.role_sites (
  id          uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  site_id     uuid NOT NULL REFERENCES core.sites (id),
  role_id     uuid NOT NULL REFERENCES core.roles (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES core.users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES core.users (id),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  UNIQUE (role_id, site_id)
);
SELECT public.apply_standard_columns('core.role_sites');
SELECT public.enable_site_isolation('core.role_sites');
CREATE INDEX role_sites_site ON core.role_sites (site_id);
COMMENT ON TABLE core.role_sites IS 'Sites a role is limited to when its site_scope is listed. Removing a site deletes the row (audited).';
COMMENT ON COLUMN core.role_sites.role_id IS 'Role limited.';

-- ---------------------------------------------------------------- sessions
CREATE TABLE core.sessions (
  id           uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  user_id      uuid NOT NULL REFERENCES core.users (id),
  token_hash   bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  mfa_pending  boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip_address   inet,
  user_agent   text CHECK (length(user_agent) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES core.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES core.users (id),
  row_version  integer NOT NULL DEFAULT 1 CHECK (row_version > 0)
);
SELECT public.apply_standard_columns('core.sessions');
CREATE INDEX sessions_user ON core.sessions (user_id);
CREATE INDEX sessions_expires ON core.sessions (expires_at);
COMMENT ON TABLE core.sessions IS 'Signed-in browser sessions. The cookie holds a random token; only its SHA-256 hash is stored. Old rows are deleted by the worker.';
COMMENT ON COLUMN core.sessions.user_id IS 'User signed in.';
COMMENT ON COLUMN core.sessions.token_hash IS 'SHA-256 of the session token in the cookie. The token itself is never stored.';
COMMENT ON COLUMN core.sessions.mfa_pending IS 'True after a correct password while the two-factor code is still owed; such a session grants nothing else.';
COMMENT ON COLUMN core.sessions.last_seen_at IS 'Last request on this session; the session ends after NORTHKIT_SESSION_IDLE_MINUTES without one.';
COMMENT ON COLUMN core.sessions.expires_at IS 'Absolute end of the session (NORTHKIT_SESSION_ABSOLUTE_HOURS after sign-in).';
COMMENT ON COLUMN core.sessions.revoked_at IS 'When the session was ended by sign-out or an admin; null while live.';
COMMENT ON COLUMN core.sessions.ip_address IS '[personal] IP address at sign-in.';
COMMENT ON COLUMN core.sessions.user_agent IS '[personal] Browser user agent at sign-in, cut to 500 characters.';

-- ---------------------------------------------------------------- privileges
-- Assignment rows and old sessions are removed, not archived.
GRANT DELETE ON core.user_roles, core.user_sites, core.role_sites, core.sessions TO northkit_app;

-- ---------------------------------------------------------------- effective scope
CREATE FUNCTION core.user_is_admin(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT FROM core.user_roles ur
      JOIN core.roles r ON r.id = ur.role_id AND r.full_access AND r.archived_at IS NULL
      JOIN core.users u ON u.id = ur.user_id AND u.archived_at IS NULL
     WHERE ur.user_id = p_user_id);
$$;
COMMENT ON FUNCTION core.user_is_admin(uuid) IS 'True if the user is live and holds the full-access Administrator role.';

-- The sites a user may work with. Runs as northkit_owner (owner_access policy)
-- because the caller has no scope yet: this is how the scope is built.
CREATE FUNCTION core.accessible_site_ids(p_user_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}')
    FROM core.users u
    CROSS JOIN core.sites s
   WHERE u.id = p_user_id
     AND u.archived_at IS NULL
     AND (core.user_is_admin(u.id)
          OR ((u.all_sites
               OR EXISTS (SELECT FROM core.user_sites us WHERE us.user_id = u.id AND us.site_id = s.id))
              AND EXISTS (SELECT FROM core.user_roles ur
                            JOIN core.roles r ON r.id = ur.role_id AND r.archived_at IS NULL
                           WHERE ur.user_id = u.id
                             AND (r.site_scope = 'all'
                                  OR EXISTS (SELECT FROM core.role_sites rs
                                              WHERE rs.role_id = r.id AND rs.site_id = s.id)))));
$$;
ALTER FUNCTION core.accessible_site_ids(uuid) OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION core.accessible_site_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.accessible_site_ids(uuid) TO northkit_app;
COMMENT ON FUNCTION core.accessible_site_ids(uuid) IS 'Site ids (live and archived) a user may work with: every site for an Administrator; otherwise their own sites (all_sites or user_sites) that at least one of their live roles covers. Empty for archived users. Feeds app.site_ids.';

-- ---------------------------------------------------------------- at least one administrator
CREATE FUNCTION core.require_active_administrator() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM core.user_roles ur
      JOIN core.roles r ON r.id = ur.role_id AND r.full_access AND r.archived_at IS NULL
      JOIN core.users u ON u.id = ur.user_id AND u.archived_at IS NULL) THEN
    RAISE EXCEPTION 'At least one active administrator must remain.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'one_active_administrator';
  END IF;
END
$$;
COMMENT ON FUNCTION core.require_active_administrator() IS 'Raises unless at least one live user holds the Administrator role.';

CREATE FUNCTION core.keep_administrator_role() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT FROM core.roles WHERE id = OLD.role_id AND full_access) THEN
    PERFORM core.require_active_administrator();
  END IF;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION core.keep_administrator_role() IS 'Constraint trigger on user_roles: refuses to commit the removal of an Administrator role that leaves no active administrator.';

CREATE FUNCTION core.keep_administrator_user() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
     AND EXISTS (SELECT FROM core.user_roles ur JOIN core.roles r ON r.id = ur.role_id AND r.full_access
                  WHERE ur.user_id = NEW.id) THEN
    PERFORM core.require_active_administrator();
  END IF;
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION core.keep_administrator_user() IS 'Constraint trigger on users: refuses to commit archiving the last active administrator.';

-- Deferred to commit, so an administrator can be swapped for another in one transaction.
CREATE CONSTRAINT TRIGGER one_active_administrator AFTER UPDATE OR DELETE ON core.user_roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.keep_administrator_role();
CREATE CONSTRAINT TRIGGER one_active_administrator AFTER UPDATE OF archived_at ON core.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.keep_administrator_user();
