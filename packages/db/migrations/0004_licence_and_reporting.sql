-- Licence (S1-7) and the first reporting views (DB-10).

-- ---------------------------------------------------------------- licences
-- Each installed licence file is kept, newest wins: installing a renewal adds a row.
-- The file is verified offline against NorthSpec's public key every time it is read
-- (packages/licence); these columns are a copy of its contents for display and audit.
CREATE TABLE core.licences (
  id           uuid PRIMARY KEY DEFAULT public.uuid_v7(),
  licence_text text NOT NULL CHECK (length(licence_text) BETWEEN 1 AND 20000),
  licence_ref  text NOT NULL CHECK (length(licence_ref) BETWEEN 1 AND 100),
  licensee     text NOT NULL CHECK (length(btrim(licensee)) BETWEEN 1 AND 200),
  issued_on    date NOT NULL,
  expires_on   date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES core.users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES core.users (id),
  row_version  integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  CHECK (expires_on IS NULL OR expires_on >= issued_on)
);
SELECT public.apply_standard_columns('core.licences');
SELECT audit.track('core.licences');
CREATE INDEX licences_newest ON core.licences (created_at DESC);
COMMENT ON TABLE core.licences IS 'Licence files installed by an administrator, newest first; the newest one that verifies is in force. Rows are never changed or deleted: a renewal is a new row.';
COMMENT ON COLUMN core.licences.licence_text IS 'The signed licence file exactly as issued by NorthSpec (JSON with an Ed25519 signature). Verified offline on every read.';
COMMENT ON COLUMN core.licences.licence_ref IS 'NorthSpec''s reference for the licence, from the file.';
COMMENT ON COLUMN core.licences.licensee IS 'Customer the licence was issued to, from the file.';
COMMENT ON COLUMN core.licences.issued_on IS 'Date the licence was issued, from the file.';
COMMENT ON COLUMN core.licences.expires_on IS 'Last day the licence covers, from the file; null for a perpetual licence.';
REVOKE UPDATE ON core.licences FROM northkit_app;

-- The licence's site limit counts every live site, whatever the caller can see.
CREATE FUNCTION core.live_site_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer FROM core.sites WHERE archived_at IS NULL;
$$;
ALTER FUNCTION core.live_site_count() OWNER TO northkit_owner;
REVOKE EXECUTE ON FUNCTION core.live_site_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.live_site_count() TO northkit_app;
COMMENT ON FUNCTION core.live_site_count() IS 'Number of live (not archived) sites across the install, for the licence site limit. Reveals only a count.';

-- ---------------------------------------------------------------- reporting views
-- The views run as their owner (the default), so they show every site, as the reporting
-- role always has: it is for the operator's own analysts. Only that role can read them;
-- the app can't, so they can't be used to step round its row-level security.
CREATE VIEW reporting.sites AS
SELECT s.id AS site_id, s.code AS site_code, s.name AS site_name, s.town, s.postcode,
       s.country_code, s.time_zone, s.archived_at IS NOT NULL AS archived
  FROM core.sites s;
COMMENT ON VIEW reporting.sites IS 'One row per site (depot or branch), for Power BI and Excel.';
COMMENT ON COLUMN reporting.sites.site_id IS 'Site id (core.sites.id).';
COMMENT ON COLUMN reporting.sites.site_code IS 'Site reference.';
COMMENT ON COLUMN reporting.sites.site_name IS 'Site name.';
COMMENT ON COLUMN reporting.sites.town IS 'Town or city.';
COMMENT ON COLUMN reporting.sites.postcode IS 'Postcode.';
COMMENT ON COLUMN reporting.sites.country_code IS 'ISO 3166-1 alpha-2 country code.';
COMMENT ON COLUMN reporting.sites.time_zone IS 'IANA time zone of the site.';
COMMENT ON COLUMN reporting.sites.archived IS 'True if the site is archived.';

CREATE VIEW reporting.locations AS
SELECT l.id AS location_id, s.code AS site_code, p.code AS parent_code, l.code AS location_code,
       l.name AS location_name, l.kind, nlevel(l.path) AS depth, l.archived_at IS NOT NULL AS archived
  FROM core.locations l
  JOIN core.sites s ON s.id = l.site_id
  LEFT JOIN core.locations p ON p.id = l.parent_id;
COMMENT ON VIEW reporting.locations IS 'Every location with its site and parent codes, for Power BI and Excel.';
COMMENT ON COLUMN reporting.locations.location_id IS 'Location id (core.locations.id).';
COMMENT ON COLUMN reporting.locations.site_code IS 'Site reference.';
COMMENT ON COLUMN reporting.locations.parent_code IS 'Parent location code; empty at the top of the tree.';
COMMENT ON COLUMN reporting.locations.location_code IS 'Location code.';
COMMENT ON COLUMN reporting.locations.location_name IS 'Location name.';
COMMENT ON COLUMN reporting.locations.kind IS 'site, van, store or yard.';
COMMENT ON COLUMN reporting.locations.depth IS 'Level in the tree: 1 at the top.';
COMMENT ON COLUMN reporting.locations.archived IS 'True if the location is archived.';

GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO northkit_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM northkit_app;
