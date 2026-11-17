import { withScope, type Db, type Role, type Tx } from '@northkit/db';
import { z } from 'zod';
import { isPermission, PERMISSIONS, withImpliedView, type Permission } from '../auth/permissions';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { isUniqueViolation, parse } from './validation';

// Roles: on/off switches per area (View, Create, Edit, Approve), a site scope and an
// optional two-factor requirement. Copied from NorthCore WMS (ADR 0006 there) and
// adapted: no client or device scope. Every change is audited by triggers.

export type SiteScope = 'all' | 'listed';

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  fullAccess: boolean;
  isSystem: boolean;
  siteScope: SiteScope;
  requiresMfa: boolean;
  archivedAt: Date | null;
  rowVersion: number;
  /** Live users holding the role. */
  userCount: number;
}

export interface RoleDetail extends RoleSummary {
  /** Listed sites, within the actor's own sites (role_sites is site-owned). */
  siteIds: string[];
}

const uuid = z.string().uuid();
export const roleInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
    description: z
      .string()
      .trim()
      .max(500, 'Use 500 characters or fewer.')
      .transform((v) => v || null)
      .nullable()
      .default(null),
    permissions: z
      .array(z.string())
      .default([])
      .refine((codes) => codes.every(isPermission), 'Unknown permission.')
      .transform((codes) => withImpliedView(codes as Permission[])),
    siteScope: z.enum(['all', 'listed']).default('all'),
    siteIds: z.array(uuid).default([]),
    requiresMfa: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.siteScope === 'listed' && v.siteIds.length === 0)
      ctx.addIssue({ code: 'custom', path: ['siteIds'], message: 'Choose at least one site.' });
  });
export type RoleInput = z.input<typeof roleInputSchema>;

/** A role code from its name: lower case, underscores, unique enough with a suffix. */
function codeFrom(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  const start = /^[a-z]/.test(base) ? base : `role_${base}`;
  return `${start}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 40);
}

function toSummary(row: Role & { user_count: number | string | null }): RoleSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    permissions: row.full_access ? [...PERMISSIONS] : row.permissions.filter(isPermission),
    fullAccess: row.full_access,
    isSystem: row.is_system,
    siteScope: row.site_scope,
    requiresMfa: row.requires_mfa,
    archivedAt: row.archived_at,
    rowVersion: row.row_version,
    userCount: Number(row.user_count),
  };
}

function roleQuery(tx: Tx) {
  return tx
    .selectFrom('core.roles as r')
    .selectAll('r')
    .select((eb) =>
      eb
        .selectFrom('core.user_roles as ur')
        .innerJoin('core.users as u', 'u.id', 'ur.user_id')
        .select(eb.fn.countAll<number>().as('n'))
        .whereRef('ur.role_id', '=', 'r.id')
        .where('u.archived_at', 'is', null)
        .as('user_count'),
    );
}

/** Roles change what everyone can do, so only someone who works at every site may change them. */
function requireRoleEditor(actor: ActorContext): void {
  if (!actor.allSites)
    throw new ForbiddenError('Only users who work at every site can change roles.');
}

/** Nobody can hand out a permission they don't hold themselves. */
function requireHeld(actor: ActorContext, permissions: readonly Permission[]): void {
  const missing = permissions.filter((p) => !actor.permissions.has(p));
  if (missing.length)
    throw new ForbiddenError(
      `You can’t give a role permissions you don’t have yourself (${missing.join(', ')}).`,
    );
}

export async function listRoles(
  db: Db,
  actor: ActorContext,
  options: { includeArchived?: boolean } = {},
): Promise<RoleSummary[]> {
  requirePermission(actor, 'users.view');
  const rows = await withScope(db, scopeOf(actor), (tx) => {
    let q = roleQuery(tx)
      .orderBy('r.full_access', 'desc')
      .orderBy('r.is_system', 'desc')
      .orderBy('r.name');
    if (!options.includeArchived) q = q.where('r.archived_at', 'is', null);
    return q.execute();
  });
  return rows.map((row) => toSummary(row));
}

export async function getRole(db: Db, actor: ActorContext, id: string): Promise<RoleDetail> {
  requirePermission(actor, 'users.view');
  return withScope(db, scopeOf(actor), async (tx) => {
    const row = await roleQuery(tx).where('r.id', '=', id).executeTakeFirst();
    if (!row) throw new NotFoundError('Role not found.');
    const sites = await tx
      .selectFrom('core.role_sites')
      .select('site_id')
      .where('role_id', '=', id)
      .execute();
    return { ...toSummary(row), siteIds: sites.map((s) => s.site_id) };
  });
}

async function writeSites(
  tx: Tx,
  actor: ActorContext,
  roleId: string,
  values: z.output<typeof roleInputSchema>,
): Promise<void> {
  // role_sites is site-owned: this only ever touches sites in the actor's scope.
  await tx.deleteFrom('core.role_sites').where('role_id', '=', roleId).execute();
  if (values.siteScope !== 'listed') return;
  if (values.siteIds.some((id) => !actor.siteIds.includes(id)))
    throw new ValidationError('Check the highlighted fields.', { siteIds: 'Unknown site.' });
  await tx
    .insertInto('core.role_sites')
    .values([...new Set(values.siteIds)].map((site_id) => ({ role_id: roleId, site_id })))
    .execute();
}

const NAME_TAKEN = 'A role with that name already exists.';

export async function createRole(
  db: Db,
  actor: ActorContext,
  input: RoleInput,
): Promise<RoleDetail> {
  requirePermission(actor, 'users.create');
  requireRoleEditor(actor);
  const values = parse(roleInputSchema, input);
  requireHeld(actor, values.permissions);
  try {
    const id = await withScope(db, scopeOf(actor), async (tx) => {
      const role = await tx
        .insertInto('core.roles')
        .values({
          code: codeFrom(values.name),
          name: values.name,
          description: values.description,
          permissions: values.permissions,
          site_scope: values.siteScope,
          requires_mfa: values.requiresMfa,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeSites(tx, actor, role.id, values);
      return role.id;
    });
    return getRole(db, actor, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(NAME_TAKEN);
    throw error;
  }
}

async function lockedCheck(tx: Tx, id: string): Promise<{ is_system: boolean }> {
  const role = await tx
    .selectFrom('core.roles')
    .select(['full_access', 'is_system'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('Role not found.');
  if (role.full_access)
    throw new ValidationError(
      'The Administrator role always has full access and can’t be changed.',
    );
  return role;
}

/** Saves a role's switches, site scope and two-factor rule (optimistic locking). */
export async function updateRole(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  input: RoleInput,
): Promise<RoleDetail> {
  requirePermission(actor, 'users.edit');
  requireRoleEditor(actor);
  const values = parse(roleInputSchema, input);
  requireHeld(actor, values.permissions);
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      await lockedCheck(tx, id);
      const updated = await tx
        .updateTable('core.roles')
        .set({
          name: values.name,
          description: values.description,
          permissions: values.permissions,
          site_scope: values.siteScope,
          requires_mfa: values.requiresMfa,
        })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .returning('id')
        .executeTakeFirst();
      if (!updated)
        throw new ConflictError('Someone else changed this role. Reload it and try again.');
      await writeSites(tx, actor, id, values);
    });
    return getRole(db, actor, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(NAME_TAKEN);
    throw error;
  }
}

/** Archive or restore a role. Seeded roles stay; archiving takes the role away from its users. */
export async function setRoleArchived(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  archived: boolean,
): Promise<void> {
  requirePermission(actor, 'users.edit');
  requireRoleEditor(actor);
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      const role = await lockedCheck(tx, id);
      if (archived && role.is_system)
        throw new ValidationError('Roles that come with NorthKit can be edited but not archived.');
      const result = await tx
        .updateTable('core.roles')
        .set({ archived_at: archived ? new Date() : null })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n)
        throw new ConflictError('Someone else changed this role. Reload it and try again.');
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError('A live role already has that name. Rename one first.');
    throw error;
  }
}
