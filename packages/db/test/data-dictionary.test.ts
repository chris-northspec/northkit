import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readDictionary, renderDictionary } from '../src/data-dictionary';
import { adminPool } from './helpers';

let admin: pg.Pool;
beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  await admin.end();
});

describe('data dictionary (DB-14)', () => {
  it('finds a COMMENT on every schema, table and column after migration', async () => {
    const dictionary = await readDictionary(admin);
    expect(dictionary.missing).toEqual([]);
    expect(dictionary.tables.map((t) => `${t.schema}.${t.name}`)).toEqual(
      expect.arrayContaining([
        'core.users',
        'core.sites',
        'core.locations',
        'audit.audit_events',
        'reporting.locations',
      ]),
    );
  });

  it('reports a table and column added without comments', async () => {
    await admin.query('CREATE TABLE core.uncommented_probe (id uuid, note text)');
    try {
      await admin.query(`COMMENT ON COLUMN core.uncommented_probe.id IS 'Has one.'`);
      const { missing } = await readDictionary(admin);
      expect(missing).toEqual([
        'table core.uncommented_probe',
        'column core.uncommented_probe.note',
      ]);
    } finally {
      await admin.query('DROP TABLE core.uncommented_probe');
    }
  });

  it('documents partitioned tables once, not each partition', async () => {
    const dictionary = await readDictionary(admin);
    const files = renderDictionary(dictionary);
    const audit = files.get('audit.md') ?? '';
    expect(audit).toContain('## `audit.audit_events`');
    expect(audit).toMatch(/partitioned by month/);
    expect(audit).not.toMatch(/audit_events_y\d{4}m\d{2}`/);
    expect(files.get('README.md')).toContain('[`core`](core.md)');
  });

  it('tags personal-data columns (DB-13)', async () => {
    const dictionary = await readDictionary(admin);
    const users = dictionary.tables.find((t) => t.schema === 'core' && t.name === 'users')!;
    const personal = users.columns.filter((c) => c.comment?.startsWith('[personal]'));
    expect(personal.map((c) => c.column).sort()).toEqual(['display_name', 'email', 'phone']);
  });
});
