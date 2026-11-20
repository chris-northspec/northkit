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
  /** [personal] The person who looks after a van. */
  assigned_user_id: Defaulted<string | null>;
  /** When a stocktake of the location was last closed. */
  last_counted_at: Defaulted<Date | null>;
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

export const RULE_TYPES = ['loler', 'puwer', 'pat', 'calibration', 'pre_use', 'other'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const ITEM_STATUSES = [
  'available',
  'out',
  'in_transit',
  'quarantined',
  'missing',
  'retired',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface KindsTable extends StandardColumns {
  name: string;
  description: Defaulted<string | null>;
  asset_prefix: Defaulted<string | null>;
  active: Defaulted<boolean>;
  /** Days this kind is normally out for; null uses the organisation setting. */
  default_days_out: Defaulted<number | null>;
}

export interface KindRulesTable extends StandardColumns {
  kind_id: string;
  rule_type: RuleType;
  title: string;
  interval_value: number;
  interval_unit: 'days' | 'months';
  required: Defaulted<boolean>;
  note: Defaulted<string | null>;
  sort_order: Defaulted<number>;
}

export interface AssetCountersTable {
  id: Generated<string>;
  prefix: string;
  last_number: Defaulted<number>;
}

export interface ItemsTable extends StandardColumns {
  site_id: string;
  kind_id: string;
  asset_number: string;
  serial_number: Defaulted<string | null>;
  make: Defaulted<string | null>;
  model: Defaulted<string | null>;
  description: Defaulted<string | null>;
  purchase_date: Defaulted<string | null>;
  /** bigint: read as a number by the pool; whole pence. */
  cost_pence: Defaulted<number | null>;
  ownership: Defaulted<'owned' | 'hired_in'>;
  hire_company: Defaulted<string | null>;
  hire_reference: Defaulted<string | null>;
  off_hire_date: Defaulted<string | null>;
  location_id: Defaulted<string | null>;
  status: Defaulted<ItemStatus>;
  retired_at: Defaulted<Date | null>;
  retired_reason: Defaulted<string | null>;
  is_kit: Defaulted<boolean>;
  parent_id: Defaulted<string | null>;
  label_version: Defaulted<number>;
  attributes: ColumnType<Record<string, unknown>, string | undefined, string>;
  notes: Defaulted<string | null>;
  /** Set only by the movement trigger. */
  holder_user_id: Defaulted<string | null>;
  due_back_on: Defaulted<string | null>;
  overdue_at: Defaulted<Date | null>;
  checked_out_at: Defaulted<Date | null>;
}

export interface ItemPhotosTable extends StandardColumns {
  site_id: string;
  item_id: string;
  content_type: 'image/jpeg' | 'image/png' | 'image/webp';
  byte_size: number;
  width: number;
  height: number;
  sha256: string;
  storage_key: string;
  thumb_key: Defaulted<string | null>;
  thumb_failed: Defaulted<boolean>;
  sort_order: Defaulted<number>;
}

export type ImportStatus =
  'queued' | 'checking' | 'problems' | 'ready' | 'loading' | 'loaded' | 'failed';

export interface ImportsTable extends StandardColumns {
  file_name: string;
  file_format: 'csv' | 'xlsx';
  stored_name: string;
  byte_size: number;
  status: Defaulted<ImportStatus>;
  row_count: Defaulted<number>;
  items_loaded: Defaulted<number>;
  report: ColumnType<Record<string, unknown>, string | undefined, string>;
  error: Defaulted<string | null>;
}

export const MOVEMENT_TYPES = [
  'check_out',
  'check_in',
  'move',
  'missing',
  'found',
  'transfer_out',
  'transfer_in',
  'transfer_cancel',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Evidence: insert only. from_* are filled in by the trigger from the item. */
export interface MovementsTable {
  id: Defaulted<string>;
  site_id: string;
  item_id: string;
  movement_type: MovementType;
  from_user_id: Defaulted<string | null>;
  from_location_id: Defaulted<string | null>;
  to_user_id: Defaulted<string | null>;
  to_location_id: Defaulted<string | null>;
  /** Filled in by the trigger. */
  from_status: Defaulted<ItemStatus>;
  to_status: Defaulted<ItemStatus>;
  due_back_on: Defaulted<string | null>;
  note: Defaulted<string | null>;
  occurred_at: ColumnType<Date, Date | string | undefined, never>;
  via_kit_id: Defaulted<string | null>;
  transfer_id: Defaulted<string | null>;
  created_at: TriggerSet<Date>;
  created_by: TriggerSet<string | null>;
  updated_at: TriggerSet<Date>;
  updated_by: TriggerSet<string | null>;
  row_version: TriggerSet<number>;
}

export type TransferStatus = 'in_transit' | 'received' | 'cancelled';

export interface TransfersTable extends StandardColumns {
  site_id: string;
  to_site_id: string;
  item_id: string;
  kit_transfer_id: Defaulted<string | null>;
  from_site_code: string;
  to_site_code: string;
  from_time_zone: string;
  asset_number: string;
  kind_name: string;
  carrier: string;
  expected_on: string;
  sent_at: ColumnType<Date, Date | string | undefined, never>;
  note: Defaulted<string | null>;
  status: Defaulted<TransferStatus>;
  closed_at: Defaulted<Date | null>;
  closed_by: Defaulted<string | null>;
  received_location_id: Defaulted<string | null>;
  received_note: Defaulted<string | null>;
}

export interface StocktakesTable extends StandardColumns {
  site_id: string;
  location_id: string;
  status: Defaulted<'counting' | 'closed'>;
  started_at: ColumnType<Date, Date | string | undefined, never>;
  closed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  closed_by: Defaulted<string | null>;
  expected_count: Defaulted<number | null>;
  found_count: Defaulted<number | null>;
  not_found_count: Defaulted<number | null>;
  unexpected_count: Defaulted<number | null>;
  note: Defaulted<string | null>;
}

export type StocktakeOutcome = 'found' | 'not_found' | 'unexpected';
export type StocktakeDecision = 'missing' | 'ignored' | 'moved_here' | 'note_only';

export interface StocktakeLinesTable extends StandardColumns {
  site_id: string;
  stocktake_id: string;
  item_id: string;
  scanned_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  scanned_by: Defaulted<string | null>;
  expected: Defaulted<boolean | null>;
  outcome: Defaulted<StocktakeOutcome | null>;
  decision: Defaulted<StocktakeDecision | null>;
  reason: Defaulted<string | null>;
}

export interface Database {
  'register.kinds': KindsTable;
  'register.kind_rules': KindRulesTable;
  'register.asset_counters': AssetCountersTable;
  'register.items': ItemsTable;
  'register.item_photos': ItemPhotosTable;
  'register.imports': ImportsTable;
  'movements.movements': MovementsTable;
  'movements.transfers': TransfersTable;
  'movements.stocktakes': StocktakesTable;
  'movements.stocktake_lines': StocktakeLinesTable;
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
export type Kind = Selectable<KindsTable>;
export type KindRule = Selectable<KindRulesTable>;
export type Item = Selectable<ItemsTable>;
export type ItemPhoto = Selectable<ItemPhotosTable>;
export type Movement = Selectable<MovementsTable>;
export type Transfer = Selectable<TransfersTable>;
export type Stocktake = Selectable<StocktakesTable>;
export type StocktakeLine = Selectable<StocktakeLinesTable>;
export type ItemImport = Selectable<ImportsTable>;
export type Role = Selectable<RolesTable>;
export type Licence = Selectable<LicencesTable>;
export type AuditEvent = Selectable<AuditEventsTable>;
