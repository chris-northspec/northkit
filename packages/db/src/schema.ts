import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

// Hand-written to match the SQL migrations. The database is the source of truth;
// integration tests exercise these shapes against it.

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** Set by the maintain_standard_columns trigger; any value written is ignored. */
type TriggerSet<T> = ColumnType<T, T | undefined, T | undefined>;
/** A column with a database default: optional on insert. */
type Defaulted<T> = ColumnType<T, T | undefined, T>;

interface StandardColumns {
  id: Generated<string>;
  created_at: TriggerSet<Date>;
  created_by: TriggerSet<string | null>;
  updated_at: TriggerSet<Date>;
  updated_by: TriggerSet<string | null>;
  row_version: TriggerSet<number>;
}

interface Archivable {
  archived_at: Timestamp | null;
}

export interface UsersTable extends StandardColumns, Archivable {
  email: string;
  display_name: string;
  phone: Defaulted<string | null>;
  password_hash: Defaulted<string | null>;
  must_change_password: Defaulted<boolean>;
  mfa_secret_encrypted: Defaulted<string | null>;
  mfa_enabled_at: Defaulted<Date | null>;
  mfa_last_used_step: Defaulted<number | null>;
  failed_login_count: Defaulted<number>;
  locked_until: Defaulted<Date | null>;
  last_login_at: Defaulted<Date | null>;
  all_sites: Defaulted<boolean>;
  home_site_id: Defaulted<string | null>;
}

export interface OrganisationsTable extends StandardColumns {
  singleton: Defaulted<boolean>;
  name: string;
  country_code: Defaulted<string>;
  default_time_zone: Defaulted<string>;
  /** cidr[]: read it as text[] (`trusted_proxies::text[]`). */
  trusted_proxies: Defaulted<string[]>;
}

export interface SitesTable extends StandardColumns, Archivable {
  code: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  town: string | null;
  postcode: string | null;
  country_code: Defaulted<string>;
  time_zone: Defaulted<string>;
  phone: string | null;
  email: string | null;
  manager_user_id: string | null;
  notes: string | null;
}

export const LOCATION_KINDS = ['site', 'van', 'store', 'yard'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface LocationsTable extends StandardColumns, Archivable {
  site_id: string;
  parent_id: string | null;
  kind: LocationKind;
  code: string;
  name: string;
  reference: Defaulted<string | null>;
  notes: Defaulted<string | null>;
  /** Maintained by trigger from parent_id. */
  path: TriggerSet<string>;
}

export interface SettingsTable extends StandardColumns {
  key: string;
  value: ColumnType<unknown, string, string>;
  description: string;
}

export type SiteScope = 'all' | 'listed';

export interface RolesTable extends StandardColumns, Archivable {
  code: string;
  name: string;
  description: string | null;
  permissions: Defaulted<string[]>;
  full_access: Defaulted<boolean>;
  site_scope: Defaulted<SiteScope>;
  requires_mfa: Defaulted<boolean>;
  is_system: Defaulted<boolean>;
}

export interface UserRolesTable extends StandardColumns {
  user_id: string;
  role_id: string;
}

export interface UserSitesTable extends StandardColumns {
  site_id: string;
  user_id: string;
}

export interface RoleSitesTable extends StandardColumns {
  site_id: string;
  role_id: string;
}

export interface SessionsTable extends StandardColumns {
  user_id: string;
  token_hash: Buffer;
  mfa_pending: Defaulted<boolean>;
  last_seen_at: Defaulted<Date>;
  expires_at: Date;
  revoked_at: Defaulted<Date | null>;
  ip_address: string | null;
  user_agent: string | null;
}

export interface LicencesTable extends StandardColumns {
  licence_text: string;
  licence_ref: string;
  licensee: string;
  issued_on: string;
  expires_on: string | null;
}

export interface AuditEventsTable {
  id: Generated<string>;
  created_at: Generated<Date>;
  created_by: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  site_id: string | null;
  before: ColumnType<unknown, string | null | undefined, never>;
  after: ColumnType<unknown, string | null | undefined, never>;
  ip_address: string | null;
}

export interface Database {
  'core.users': UsersTable;
  'core.organisations': OrganisationsTable;
  'core.sites': SitesTable;
  'core.locations': LocationsTable;
  'core.settings': SettingsTable;
  'core.roles': RolesTable;
  'core.user_roles': UserRolesTable;
  'core.user_sites': UserSitesTable;
  'core.role_sites': RoleSitesTable;
  'core.sessions': SessionsTable;
  'core.licences': LicencesTable;
  'audit.audit_events': AuditEventsTable;
}

export type User = Selectable<UsersTable>;
export type Organisation = Selectable<OrganisationsTable>;
export type Site = Selectable<SitesTable>;
export type Location = Selectable<LocationsTable>;
export type NewLocation = Insertable<LocationsTable>;
export type Setting = Selectable<SettingsTable>;
export type Role = Selectable<RolesTable>;
export type Licence = Selectable<LicencesTable>;
export type AuditEvent = Selectable<AuditEventsTable>;
