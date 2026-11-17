import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS, PERMISSIONS, withImpliedView } from '../src/auth/permissions';
import { can } from '../src/context';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/errors';
import { createRole, getRole, listRoles, setRoleArchived, updateRole } from '../src/services/roles';
import { createSite, getSite, listSites } from '../src/services/sites';
import { archiveUser, createUser, setUserAccess } from '../src/services/users';
import { fixtures, type Fixtures } from './fixtures';

let f: Fixtures;
let siteA: string;
let siteB: string;
let adminId: string;

beforeAll(async () => {
  f = fixtures();
  siteA = await f.site();
  siteB = await f.site();
  adminId = (await f.user({ roles: ['admin'], allSites: true, mfa: true })).id;
});
afterAll(() => f.close());

describe('permission catalogue', () => {
  it('is nine areas by View, Create, Edit, Approve, matching the database', async () => {
    expect(AREAS).toHaveLength(9);
    expect(PERMISSIONS).toHaveLength(36);
    const { rows } = await f.admin.query('SELECT core.permission_codes() AS codes');
    expect(rows[0].codes).toEqual([...PERMISSIONS]);
  });

  it('gives View with any other switch in the same area', () => {
    expect(withImpliedView(['checkouts.approve'])).toEqual(['checkouts.view', 'checkouts.approve']);
  });

  it('ships the default roles from the spec', async () => {
    const roles = await listRoles(f.db, await f.actor(adminId));
    expect(roles.filter((r) => r.isSystem).map((r) => r.code)).toEqual([
      'admin',
      'kit_manager',
      'operative',
      'supervisor',
      'viewer',
    ]);
    const admin = roles.find((r) => r.code === 'admin')!;
    expect(admin).toMatchObject({ fullAccess: true, requiresMfa: true });
    expect(admin.permissions).toHaveLength(36);
  });

  it('the database refuses an unknown permission code', async () => {
    await expect(
      f.admin.query(
        `INSERT INTO core.roles (code, name, permissions) VALUES ('bad_${f.tag.toLowerCase()}', 'Bad ${f.tag}', '{stock.move}')`,
      ),
    ).rejects.toMatchObject({ constraint: 'roles_permissions_known' });
  });
});

describe('role switches (S1-4)', () => {
  it('turning a switch on or off changes what holders can do at once', async () => {
    const adminActor = await f.actor(adminId);
    const role = await createRole(f.db, adminActor, {
      name: `Depot viewer ${f.tag}`,
      permissions: ['overview.view'],
    });
    const user = await f.user({ roles: [role.code], allSites: true });

    let actor = await f.actor(user.id);
    expect(can(actor, 'overview.view')).toBe(true);
    expect((await listSites(f.db, actor)).length).toBeGreaterThan(0);
    await expect(
      createSite(f.db, actor, { code: `NEW${f.tag}`, name: 'New' }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const on = await updateRole(f.db, adminActor, role.id, role.rowVersion, {
      name: role.name,
      permissions: ['overview.view', 'settings.create'],
    });
    actor = await f.actor(user.id);
    expect(can(actor, 'settings.create')).toBe(true);
    const site = await createSite(f.db, actor, { code: `NEW${f.tag}`, name: 'New site' });
    expect(site.code).toBe(`NEW${f.tag}`);

    await updateRole(f.db, adminActor, role.id, on.rowVersion, {
      name: role.name,
      permissions: [],
    });
    actor = await f.actor(user.id);
    expect(actor.permissions.size).toBe(0);
    await expect(listSites(f.db, actor)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('switching a user’s role changes their access', async () => {
    const adminActor = await f.actor(adminId);
    const user = await f.user({ roles: ['operative'], siteIds: [siteA] });
    expect(can(await f.actor(user.id), 'checkouts.edit')).toBe(false);
    await setUserAccess(f.db, adminActor, user.id, { roles: ['supervisor'], siteIds: [siteA] });
    const actor = await f.actor(user.id);
    expect(can(actor, 'checkouts.edit')).toBe(true);
    expect(can(actor, 'checkouts.create')).toBe(true);
  });

  it('archiving a role takes its permissions away; restoring gives them back', async () => {
    const adminActor = await f.actor(adminId);
    const role = await createRole(f.db, adminActor, {
      name: `Temp ${f.tag}`,
      permissions: ['reports.view'],
    });
    const user = await f.user({ roles: [role.code], allSites: true });
    await setRoleArchived(f.db, adminActor, role.id, role.rowVersion, true);
    expect(can(await f.actor(user.id), 'reports.view')).toBe(false);
    const archived = await getRole(f.db, adminActor, role.id);
    await setRoleArchived(f.db, adminActor, role.id, archived.rowVersion, false);
    expect(can(await f.actor(user.id), 'reports.view')).toBe(true);
  });

  it('refuses a stale edit (optimistic locking)', async () => {
    const adminActor = await f.actor(adminId);
    const role = await createRole(f.db, adminActor, { name: `Stale ${f.tag}`, permissions: [] });
    await updateRole(f.db, adminActor, role.id, role.rowVersion, {
      name: role.name,
      permissions: ['checkouts.view'],
    });
    await expect(
      updateRole(f.db, adminActor, role.id, role.rowVersion, { name: role.name, permissions: [] }),
    ).rejects.toThrow(/Someone else changed/);
  });
});

describe('site scopes', () => {
  it('a site manager sees only their assigned sites, through the service and the database', async () => {
    const user = await f.user({ roles: ['supervisor'], siteIds: [siteA] });
    const actor = await f.actor(user.id);
    expect(actor.siteIds).toEqual([siteA]);
    expect((await listSites(f.db, actor)).map((s) => s.id)).toEqual([siteA]);
    await expect(getSite(f.db, actor, siteB)).rejects.toBeInstanceOf(NotFoundError);
    // Even a query that forgets the scope altogether gets nothing back (fail closed).
    const rows = await f.db
      .transaction()
      .execute((tx) => tx.selectFrom('core.sites').select('id').where('id', '=', siteB).execute());
    expect(rows).toEqual([]);
  });

  it('a role limited to listed sites narrows an estate-wide user', async () => {
    const adminActor = await f.actor(adminId);
    const role = await createRole(f.db, adminActor, {
      name: `Site B only ${f.tag}`,
      permissions: ['overview.view'],
      siteScope: 'listed',
      siteIds: [siteB],
    });
    const user = await f.user({ roles: [role.code], allSites: true });
    const actor = await f.actor(user.id);
    expect(actor.siteIds).toEqual([siteB]);
    expect(actor.allSites).toBe(false);
  });

  it('Kit Manager with every site sees every site, including new ones', async () => {
    const user = await f.user({ roles: ['kit_manager'], allSites: true });
    const later = await f.site();
    const actor = await f.actor(user.id);
    expect(actor.siteIds).toEqual(expect.arrayContaining([siteA, siteB, later]));
  });
});

describe('no escalation', () => {
  it('nobody can hand out permissions they don’t hold', async () => {
    const hof = await f.user({ roles: ['kit_manager'], allSites: true });
    const actor = await f.actor(hof.id);
    await expect(
      createRole(f.db, actor, { name: `Sneaky ${f.tag}`, permissions: ['users.edit'] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('only an administrator can make an administrator, and nobody changes their own access', async () => {
    const managerRole = await createRole(f.db, await f.actor(adminId), {
      name: `User manager ${f.tag}`,
      permissions: ['users.view', 'users.create', 'users.edit'],
    });
    const manager = await f.user({ roles: [managerRole.code], allSites: true });
    const actor = await f.actor(manager.id);
    const target = await f.user({ roles: ['operative'] });
    await expect(
      setUserAccess(f.db, actor, target.id, { roles: ['admin'] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setUserAccess(f.db, actor, manager.id, { roles: [managerRole.code] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a user limited to site A can’t assign site B', async () => {
    const role = await createRole(f.db, await f.actor(adminId), {
      name: `Site A admin ${f.tag}`,
      permissions: ['users.view', 'users.create', 'users.edit', 'overview.view'],
    });
    const local = await f.user({ roles: [role.code], siteIds: [siteA] });
    await expect(
      createUser(f.db, await f.actor(local.id), {
        email: `b.${f.tag.toLowerCase()}@northkit.test`,
        displayName: 'B',
        password: 'a long enough password',
        siteIds: [siteB],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('the Administrator role', () => {
  it('is locked in the database', async () => {
    await expect(
      f.admin.query(`UPDATE core.roles SET permissions = '{}' WHERE code = 'admin'`),
    ).rejects.toMatchObject({ constraint: 'roles_admin_locked' });
    await expect(
      f.admin.query(`UPDATE core.roles SET requires_mfa = false WHERE code = 'admin'`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps at least one active administrator', async () => {
    // Archive every other administrator, then try the last.
    const { rows } = await f.admin.query<{ id: string }>(
      `SELECT u.id FROM core.users u JOIN core.user_roles ur ON ur.user_id = u.id
         JOIN core.roles r ON r.id = ur.role_id AND r.code = 'admin'
        WHERE u.archived_at IS NULL AND u.id <> $1`,
      [adminId],
    );
    const second = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    const actor = await f.actor(second.id);
    for (const { id } of rows) {
      const v = await f.admin.query('SELECT row_version FROM core.users WHERE id = $1', [id]);
      await archiveUser(f.db, actor, id, v.rows[0].row_version);
    }
    const v = await f.admin.query('SELECT row_version FROM core.users WHERE id = $1', [adminId]);
    await archiveUser(f.db, actor, adminId, v.rows[0].row_version);
    const last = await f.admin.query('SELECT row_version FROM core.users WHERE id = $1', [
      second.id,
    ]);
    const other = await f.user({ roles: ['admin'], allSites: true, mfa: true });
    // `second` can't archive themselves; `other` archiving `second` leaves `other`.
    await archiveUser(f.db, await f.actor(other.id), second.id, last.rows[0].row_version);
    await expect(
      f.admin.query(`UPDATE core.users SET archived_at = now() WHERE id = $1`, [other.id]),
    ).rejects.toMatchObject({ constraint: 'one_active_administrator' });
    adminId = other.id;
  });
});
