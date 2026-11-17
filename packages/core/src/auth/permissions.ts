// A permission is an area x action, the access model copied from NorthKeep main
// (944121d) with NorthKit's areas. The same list is core.permission_codes()
// in migration 0002, which the database uses to refuse unknown codes; change both together.

export const AREAS = [
  { key: 'overview', label: 'Overview', covers: 'Dashboards, depots and what needs action' },
  { key: 'locations', label: 'Locations', covers: 'Stores, vans, yards and job sites' },
  { key: 'items', label: 'Items', covers: 'The register of tools and equipment, labels, photos' },
  {
    key: 'checkouts',
    label: 'Check-out and in',
    covers: 'Issuing, returning, transfers, stocktake',
  },
  {
    key: 'inspections',
    label: 'Inspections',
    covers: 'Inspection schedules, records, certificates, pre-use checks, quarantine',
  },
  { key: 'imports', label: 'Imports', covers: 'Spreadsheet imports' },
  { key: 'reports', label: 'Reports and exports', covers: 'Reports and CSV exports' },
  {
    key: 'users',
    label: 'Users and access',
    covers: 'Users, roles, two-factor resets, audit trail',
  },
  { key: 'settings', label: 'Settings', covers: 'Organisation, depots, licence, settings' },
] as const;

export const ACTIONS = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'approve', label: 'Approve' },
] as const;

export type Area = (typeof AREAS)[number]['key'];
export type Action = (typeof ACTIONS)[number]['key'];
export type Permission = `${Area}.${Action}`;

export const PERMISSIONS: readonly Permission[] = AREAS.flatMap((area) =>
  ACTIONS.map((action): Permission => `${area.key}.${action.key}`),
);

const known = new Set<string>(PERMISSIONS);
export function isPermission(code: string): code is Permission {
  return known.has(code);
}

/**
 * Create, Edit and Approve make no sense without View, so a role that has any of
 * them for an area also gets View for it.
 */
export function withImpliedView(codes: Iterable<Permission>): Permission[] {
  const out = new Set<Permission>(codes);
  for (const code of [...out]) {
    const [area] = code.split('.') as [Area];
    out.add(`${area}.view`);
  }
  return PERMISSIONS.filter((p) => out.has(p));
}
