import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from '../src/audit';
import type { ActorContext } from '../src/context';
import { createLocation, updateLocation } from '../src/services/locations';
import { createSite } from '../src/services/sites';
import { createUser, resetPassword } from '../src/services/users';
import { fixtures, type Fixtures } from './fixtures';

// S1-6: who, when, before and after for every create, change and delete.

let f: Fixtures;
let admin: ActorContext;
let adminId: string;
let siteId: string;

beforeAll(async () => {
  f = fixtures();
  adminId = (await f.user({ roles: ['admin'], allSites: true, mfa: true })).id;
  admin = await f.actor(adminId);
  const site = await createSite(f.db, admin, { code: `AUD${f.tag}`, name: 'Audit site' });
  siteId = site.id;
  admin = { ...admin, siteIds: [...admin.siteIds, siteId] };
});
afterAll(() => f.close());

async function eventsFor(entityId: string) {
  const { rows } = await f.admin.query(
    `SELECT action, created_by, created_at, site_id, before, after FROM audit.audit_events
      WHERE entity_id = $1 ORDER BY created_at, id`,
    [entityId],
  );
  return rows;
}

describe('audit log (S1-6)', () => {
  it('records a create with who, when and the new values', async () => {
    const started = new Date(Date.now() - 1000);
    const loc = await createLocation(f.db, admin, siteId, {
      code: 'AUD-1',
      name: 'Plant store',
      kind: 'store',
    });
    const [event] = await eventsFor(loc.id);
    expect(event).toMatchObject({
      action: 'core.locations.create',
      created_by: adminId,
      site_id: siteId,
      before: null,
      after: expect.objectContaining({ code: 'AUD-1', name: 'Plant store' }),
    });
    expect(event.created_at.getTime()).toBeGreaterThanOrEqual(started.getTime());
  });

  it('records an update with before and after', async () => {
    const loc = await createLocation(f.db, admin, siteId, {
      code: 'AUD-2',
      name: 'Old name',
      kind: 'store',
    });
    await updateLocation(f.db, admin, loc.id, loc.row_version, {
      code: 'AUD-2',
      name: 'New name',
      kind: 'store',
    });
    const events = await eventsFor(loc.id);
    expect(events.map((e) => e.action)).toEqual(['core.locations.create', 'core.locations.update']);
    expect(events[1].before.name).toBe('Old name');
    expect(events[1].after.name).toBe('New name');
    expect(events[1].created_by).toBe(adminId);
  });

  it('records a delete with the values before', async () => {
    const user = await f.user();
    await f.admin.query('INSERT INTO core.user_sites (user_id, site_id) VALUES ($1, $2)', [
      user.id,
      siteId,
    ]);
    const { rows } = await f.admin.query<{ id: string }>(
      'SELECT id FROM core.user_sites WHERE user_id = $1',
      [user.id],
    );
    const rowId = rows[0]!.id;
    await f.admin.query('DELETE FROM core.user_sites WHERE id = $1', [rowId]);
    const events = await eventsFor(rowId);
    expect(events.map((e) => e.action)).toEqual([
      'core.user_sites.create',
      'core.user_sites.delete',
    ]);
    expect(events[1]).toMatchObject({
      after: null,
      before: expect.objectContaining({ user_id: user.id, site_id: siteId }),
    });
  });

  it('records archive and restore as their own verbs', async () => {
    const loc = await createLocation(f.db, admin, siteId, {
      code: 'AUD-3',
      name: 'Store',
      kind: 'store',
    });
    await f.admin.query('UPDATE core.locations SET archived_at = now() WHERE id = $1', [loc.id]);
    await f.admin.query('UPDATE core.locations SET archived_at = NULL WHERE id = $1', [loc.id]);
    expect((await eventsFor(loc.id)).map((e) => e.action)).toEqual([
      'core.locations.create',
      'core.locations.archive',
      'core.locations.restore',
    ]);
  });

  it('never records a password hash or two-factor secret', async () => {
    const user = await createUser(f.db, admin, {
      email: `audited.${f.tag.toLowerCase()}@northkit.test`,
      displayName: 'Audited',
      password: 'first long password',
      roles: ['operative'],
      siteIds: [siteId],
    });
    await resetPassword(f.db, admin, user.id, 'second long password');
    const events = await eventsFor(user.id);
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/argon2id/);
    expect(text).not.toMatch(/mfa_secret_encrypted/);
    expect(events.find((e) => e.action === 'core.users.update').after.password_changed).toBe(true);
  });

  it('covers every table that holds data (an audit trigger on each)', async () => {
    const { rows } = await f.admin.query<{ name: string }>(`
      SELECT format('%s.%s', n.nspname, c.relname) AS name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND n.nspname IN ('core', 'register')
         AND NOT EXISTS (SELECT FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'audit_changes')
       ORDER BY 1`);
    // Sessions are covered by auth events; asset counters are bookkeeping (the number shows on the item).
    expect(rows.map((r) => r.name)).toEqual(['core.sessions', 'register.asset_counters']);
  });

  it('audits every insert, change and delete on every table with updated_at, in any schema ', async () => {
    // Every table with the standard columns, wherever it is: a new module's schema can't
    // slip past. Each must have the audit trigger, switched on, after each row's insert,
    // update and delete, calling audit.record_change. The exception says why.
    const { rows } = await f.admin.query<{
      name: string;
      trigger: boolean;
      enabled: string | null;
      type: number | null;
      fn: string | null;
    }>(`
      SELECT format('%s.%s', n.nspname, c.relname) AS name,
             t.oid IS NOT NULL AS trigger, t.tgenabled AS enabled, t.tgtype AS type,
             p.oid::regprocedure::text AS fn
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at' AND NOT a.attisdropped
        LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = 'audit_changes'
        LEFT JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'audit')
       ORDER BY 1`);
    expect(rows.length).toBeGreaterThan(8);
    const NOT_AUDITED: Record<string, string> = {
      'core.sessions': 'sign-in and sign-out are audited as auth events instead',
    };
    // tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
    const ROW_AFTER_ALL = 1 | 4 | 8 | 16;
    const gaps = rows
      .filter((r) => !(r.name in NOT_AUDITED))
      .filter(
        (r) =>
          !r.trigger ||
          r.enabled !== 'O' ||
          r.type !== ROW_AFTER_ALL ||
          r.fn !== 'audit.record_change()',
      )
      .map((r) => r.name);
    expect(gaps).toEqual([]);
    for (const name of Object.keys(NOT_AUDITED))
      expect(rows.find((r) => r.name === name)?.trigger, name).toBe(false);
  });

  it('is append-only, even for the owner', async () => {
    await expect(
      f.admin.query(`UPDATE audit.audit_events SET action = 'x.y' WHERE true`),
    ).rejects.toThrow(/append-only/);
    await expect(f.admin.query(`DELETE FROM audit.audit_events WHERE true`)).rejects.toThrow(
      /append-only/,
    );
  });

  it('shows a site manager only their sites’ events, plus organisation events', async () => {
    const other = await f.site();
    await f.admin.query(
      `INSERT INTO audit.audit_events (action, entity_type, site_id) VALUES ('test.other.site', 'test.probe', $1)`,
      [other],
    );
    const roleWithAudit = `audit_viewer_${f.tag.toLowerCase()}`;
    await f.admin.query(
      `INSERT INTO core.roles (code, name, permissions) VALUES ($1, $2, '{users.view}')`,
      [roleWithAudit, `Audit viewer ${f.tag}`],
    );
    const viewer = await f.user({ roles: [roleWithAudit], siteIds: [siteId] });
    const events = await listAuditEvents(f.db, await f.actor(viewer.id), { limit: 500 });
    expect(events.every((e) => e.site_id === null || e.site_id === siteId)).toBe(true);
    expect(events.some((e) => e.site_id === siteId)).toBe(true);
  });
});

describe('the audit log screen’s filters (S7-7)', () => {
  it('filters by person, record type, site and UK dates', async () => {
    const code = `FLT-${f.tag}`;
    const location = await createLocation(f.db, admin, siteId, {
      code,
      name: 'Filtered',
      kind: 'yard',
    });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
      new Date(),
    );
    const mine = await listAuditEvents(f.db, admin, {
      userId: adminId,
      entityType: 'core.locations',
      siteId,
      from: today,
      to: today,
      limit: 500,
    });
    expect(
      mine.some((e) => e.entity_id === location.id && e.action === 'core.locations.create'),
    ).toBe(true);
    expect(mine.every((e) => e.created_by === adminId && e.entity_type === 'core.locations')).toBe(
      true,
    );
    expect(mine.every((e) => e.site_id === siteId)).toBe(true);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(await listAuditEvents(f.db, admin, { entityId: location.id, from: tomorrow })).toEqual(
      [],
    );
    expect(await listAuditEvents(f.db, admin, { entityId: location.id, to: today })).toHaveLength(
      1,
    );
    const other = await f.user({ roles: ['admin'], allSites: true });
    expect(await listAuditEvents(f.db, admin, { entityId: location.id, userId: other.id })).toEqual(
      [],
    );
  });
});
