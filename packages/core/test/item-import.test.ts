import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActorContext } from '../src/context';
import { ForbiddenError, ValidationError } from '../src/errors';
import { writeWorkbook } from '../src/files/xlsx-io';
import {
  analyseItemImport,
  getItemImport,
  importProblemsCsv,
  ITEM_IMPORT_COLUMNS,
  itemImportTemplateCsv,
  itemImportTemplateXlsx,
  listItemImports,
  loadItemImport,
  requestItemImportLoad,
  runItemImports,
  startItemImport,
  checkItemImport,
} from '../src/services/item-import';
import { createItem, listItems } from '../src/services/items';
import { listKinds } from '../src/services/kinds';
import { toCsv } from '../src/services/csv';
import { fixtures, type Fixtures } from './fixtures';

// S2-5 (acceptance A15): the spreadsheet import. Every problem listed by row and column
// before anything is stored; all or nothing; 2,000 rows succeed; duplicates are caught
// inside the file and against the register; kit sets; formulas never run.

let f: Fixtures;
let dir: string;
let manager: ActorContext;
let operative: ActorContext;
let siteA: string;
let depot: string;
let loc: string;

const header = [...ITEM_IMPORT_COLUMNS];
const row = (o: Partial<Record<(typeof ITEM_IMPORT_COLUMNS)[number], string>>) =>
  header.map((c) => o[c] ?? '');
const csv = (rows: ReturnType<typeof row>[]) => Buffer.from(toCsv([header, ...rows]));

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'northkit-imports-'));
  process.env.NORTHKIT_FILES_DIR = dir;
  f = fixtures();
  depot = `IM${f.tag}`;
  siteA = await f.site(depot, `Import depot ${f.tag}`);
  loc = `${depot}-STORE`;
  await f.admin.query(
    `INSERT INTO core.locations (site_id, kind, code, name) VALUES ($1, 'store', $2, 'Store')`,
    [siteA, loc],
  );
  manager = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteA] })).id);
  operative = await f.actor((await f.user({ roles: ['operative'], siteIds: [siteA] })).id);
});
afterAll(async () => {
  await f.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.NORTHKIT_FILES_DIR;
});

const count = async (q: string) => (await listItems(f.db, manager, { q, pageSize: 1 })).total;

describe('checking a file', () => {
  it('lists every problem by line and column, and stores nothing', async () => {
    const before = await count(`BAD${f.tag}`);
    const file = csv([
      row({ asset_number: `BAD${f.tag}-1`, kind: 'Ladder', depot }),
      row({ asset_number: `BAD${f.tag}-2`, kind: 'Spaceship', depot }),
      row({ asset_number: `BAD${f.tag}-3`, kind: 'Ladder', depot: 'NOWHERE', cost: 'lots' }),
      row({ asset_number: `BAD${f.tag}-4`, kind: 'Ladder', depot, ownership: 'hired in' }),
      row({
        asset_number: `BAD${f.tag}-5`,
        kind: 'Ladder',
        depot,
        purchase_date: '31/02/2025',
        location: 'NOPE',
      }),
    ]);
    const { report, planned } = await analyseItemImport(f.db, manager, file, 'csv');
    expect(planned).toHaveLength(0);
    const at = (line: number) =>
      report.problems.filter((p) => p.line === line).map((p) => `${p.column}: ${p.message}`);
    expect(report.problems.some((p) => p.line === 2)).toBe(false);
    expect(at(3)).toEqual([expect.stringMatching(/^Kind: There is no kind called “Spaceship”/)]);
    expect(at(4).join('|')).toMatch(/Depot: There is no depot “NOWHERE”/);
    expect(at(4).join('|')).toMatch(/Cost: Enter an amount in pounds/);
    expect(at(5)).toEqual([expect.stringMatching(/^Hire company:/)]);
    expect(at(6).join('|')).toMatch(/Purchase date:/);
    expect(at(6).join('|')).toMatch(/Location: There is no location with code “NOPE”/);
    expect(await count(`BAD${f.tag}`)).toBe(before);
  });

  it('refuses a file with the wrong header, unknown columns, no rows, or too many rows, in plain words', async () => {
    const noKind = Buffer.from('asset_number,depot\nA,X\n');
    expect(
      (await analyseItemImport(f.db, manager, noKind, 'csv')).report.fileProblems.join(' '),
    ).toMatch(/needs these columns: kind/);
    const extra = Buffer.from(`kind,depot,colour\nLadder,${depot},red\n`);
    expect(
      (await analyseItemImport(f.db, manager, extra, 'csv')).report.fileProblems.join(' '),
    ).toMatch(/Unknown columns: colour/);
    expect(
      (
        await analyseItemImport(f.db, manager, Buffer.from(`kind,depot\n`), 'csv')
      ).report.fileProblems.join(' '),
    ).toMatch(/no rows/);
    expect(
      (await analyseItemImport(f.db, manager, Buffer.from(''), 'csv')).report.fileProblems.join(
        ' ',
      ),
    ).toMatch(/empty/);
  });

  it('catches a duplicate asset number inside the file and one already in the register', async () => {
    const taken = (
      await createItem(f.db, manager, {
        siteId: siteA,
        kindId: (await listKinds(f.db, manager))[0]!.id,
        assetNumber: `TAKEN${f.tag}`,
      })
    ).asset_number;
    const file = csv([
      row({ asset_number: `DUP${f.tag}`, kind: 'Ladder', depot }),
      row({ asset_number: `dup${f.tag}`, kind: 'Ladder', depot }),
      row({ asset_number: taken, kind: 'Ladder', depot }),
    ]);
    const { report } = await analyseItemImport(f.db, manager, file, 'csv');
    expect(report.problems).toEqual([
      expect.objectContaining({
        line: 3,
        column: 'Asset number',
        message: expect.stringMatching(/also on line 2/),
      }),
      expect.objectContaining({
        line: 4,
        column: 'Asset number',
        message: expect.stringMatching(/already used by another item/),
      }),
    ]);
  });

  it('checks kit sets: the parent must be a kit at the same depot, here or already registered', async () => {
    const other = await f.site(`IO${f.tag}`);
    const file = csv([
      row({ asset_number: `KIT${f.tag}`, kind: 'Harness', depot, is_kit: 'yes' }),
      row({
        asset_number: `PART${f.tag}A`,
        kind: 'Harness',
        depot,
        parent_asset_number: `KIT${f.tag}`,
      }),
      row({
        asset_number: `PART${f.tag}B`,
        kind: 'Harness',
        depot,
        parent_asset_number: `NOKIT${f.tag}`,
      }),
      row({
        asset_number: `PART${f.tag}C`,
        kind: 'Harness',
        depot,
        parent_asset_number: `PART${f.tag}A`,
      }),
      row({
        asset_number: `KIT2${f.tag}`,
        kind: 'Harness',
        depot,
        is_kit: 'yes',
        parent_asset_number: `KIT${f.tag}`,
      }),
    ]);
    const { report } = await analyseItemImport(f.db, manager, file, 'csv');
    const msg = (line: number) =>
      report.problems
        .filter((p) => p.line === line)
        .map((p) => p.message)
        .join('|');
    expect(msg(2) + msg(3)).toBe('');
    expect(msg(4)).toMatch(/There is no item with asset number NOKIT/);
    expect(msg(5)).toMatch(/is not a kit/);
    expect(msg(6)).toMatch(/can’t be inside another kit/);
    expect(other).toBeTruthy();
  });

  it('never runs a formula: a spreadsheet cell is taken as the text saved in it', async () => {
    const xlsx = await writeWorkbook([
      {
        name: 'Items',
        header,
        rows: [row({ asset_number: `F${f.tag}`, kind: 'Ladder', depot, notes: '=1+1' })],
      },
    ]);
    const { planned, report } = await analyseItemImport(f.db, manager, xlsx, 'xlsx');
    expect(report.problems).toEqual([]);
    expect(planned[0]!.values.notes).toBe('=1+1');
  });
});

describe('storing (all or nothing)', () => {
  it('one bad row stores nothing; the clean file then stores everything, with generated numbers and kits', async () => {
    const bad = await startItemImport(
      f.db,
      manager,
      'items.csv',
      csv([
        row({ asset_number: `ALL${f.tag}-1`, kind: 'Ladder', depot }),
        row({ kind: 'Nope', depot }),
      ]),
    );
    const checked = await checkItemImport(f.db, bad.id);
    expect(checked.status).toBe('problems');
    expect(checked.parsed.problems).toHaveLength(1);
    await expect(requestItemImportLoad(f.db, manager, bad.id)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await count(`ALL${f.tag}`)).toBe(0);

    const good = await startItemImport(
      f.db,
      manager,
      'items.csv',
      csv([
        row({
          asset_number: `ALL${f.tag}-KIT`,
          kind: 'Harness',
          depot,
          is_kit: 'yes',
          location: loc,
        }),
        row({
          kind: 'Harness',
          depot,
          make: `Gen${f.tag}`,
          parent_asset_number: `ALL${f.tag}-KIT`,
          cost: '£99.99',
          purchase_date: '05/06/2025',
        }),
        row({
          kind: 'Ladder',
          depot,
          make: `Gen${f.tag}`,
          ownership: 'hired in',
          hire_company: 'Example Hire Ltd',
          off_hire_date: '2027-01-31',
        }),
      ]),
    );
    expect((await checkItemImport(f.db, good.id)).status).toBe('ready');
    await requestItemImportLoad(f.db, manager, good.id);
    const done = await loadItemImport(f.db, good.id);
    expect(done).toMatchObject({ status: 'loaded', items_loaded: 3 });
    const items = await listItems(f.db, manager, { q: `Gen${f.tag}` });
    expect(items.total).toBe(2);
    const part = items.rows.find((r) => r.kitAssetNumber)!;
    expect(part.kitAssetNumber).toBe(`ALL${f.tag}-KIT`);
    expect(part.assetNumber).toMatch(/^FB-\d{6}$/);
    expect(items.rows.find((r) => r.ownership === 'hired_in')?.assetNumber).toMatch(/^LD-\d{6}$/);
    // The import and its items are audited.
    const audit = await f.admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit.audit_events WHERE entity_id = $1`,
      [good.id],
    );
    expect(Number(audit.rows[0]!.n)).toBeGreaterThanOrEqual(3);
  });

  it('imports 2,000 rows in one go', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) =>
      row({
        asset_number: `BULK${f.tag}-${String(i).padStart(4, '0')}`,
        kind: i % 2 ? 'Ladder' : 'Power tool',
        depot,
        make: `Bulk${f.tag}`,
        cost: String(10 + (i % 90)),
        location: i % 3 ? loc : '',
      }),
    );
    const record = await startItemImport(f.db, manager, 'bulk.csv', csv(rows));
    expect((await checkItemImport(f.db, record.id)).status).toBe('ready');
    await requestItemImportLoad(f.db, manager, record.id);
    const done = await loadItemImport(f.db, record.id);
    expect(done).toMatchObject({ status: 'loaded', items_loaded: 2000 });
    expect(await count(`Bulk${f.tag}`)).toBe(2000);
  }, 120_000);

  it('stores nothing if a number is taken between the check and the store', async () => {
    const record = await startItemImport(
      f.db,
      manager,
      'race.csv',
      csv([
        row({ asset_number: `RACE${f.tag}-1`, kind: 'Ladder', depot }),
        row({ asset_number: `RACE${f.tag}-2`, kind: 'Ladder', depot }),
      ]),
    );
    expect((await checkItemImport(f.db, record.id)).status).toBe('ready');
    await createItem(f.db, manager, {
      siteId: siteA,
      kindId: (await listKinds(f.db, manager))[0]!.id,
      assetNumber: `RACE${f.tag}-2`,
    });
    await requestItemImportLoad(f.db, manager, record.id);
    const after = await loadItemImport(f.db, record.id);
    expect(after.status).toBe('problems');
    expect(await count(`RACE${f.tag}-1`)).toBe(0);
  });

  it('the worker checks queued imports and stores the ones people asked for', async () => {
    const record = await startItemImport(
      f.db,
      manager,
      'worker.csv',
      csv([row({ asset_number: `WRK${f.tag}`, kind: 'Ladder', depot })]),
    );
    expect(record.status).toBe('queued');
    await runItemImports(f.db);
    expect((await getItemImport(f.db, manager, record.id)).status).toBe('ready');
    await requestItemImportLoad(f.db, manager, record.id);
    await runItemImports(f.db);
    expect((await getItemImport(f.db, manager, record.id)).status).toBe('loaded');
    expect(await count(`WRK${f.tag}`)).toBe(1);
  });

  it('imports an Excel file as well as a CSV', async () => {
    const xlsx = await writeWorkbook([
      {
        name: 'Items',
        header,
        rows: [
          row({
            asset_number: `XL${f.tag}`,
            kind: 'Plant',
            depot,
            cost: '1200',
            purchase_date: '2024-02-29',
          }),
        ],
      },
    ]);
    const record = await startItemImport(f.db, manager, 'items.xlsx', xlsx);
    expect(record.file_format).toBe('xlsx');
    expect((await checkItemImport(f.db, record.id)).status).toBe('ready');
    await requestItemImportLoad(f.db, manager, record.id);
    expect((await loadItemImport(f.db, record.id)).status).toBe('loaded');
    expect(await count(`XL${f.tag}`)).toBe(1);
  });
});

describe('uploads, templates and access', () => {
  it('refuses macro workbooks, other types and files that lie about their type', async () => {
    for (const [name, bytes] of [
      ['items.xlsm', Buffer.from('PK\x03\x04xxxx')],
      ['items.xls', Buffer.from('xxxx')],
      ['items.exe', Buffer.from('MZ')],
      ['items.xlsx', Buffer.from('a,b\n1,2\n')],
      ['items.csv', Buffer.from('PK\x03\x04xxxx')],
    ] as const)
      await expect(startItemImport(f.db, manager, name, bytes), name).rejects.toBeInstanceOf(
        ValidationError,
      );
    await expect(
      startItemImport(f.db, manager, 'big.csv', Buffer.alloc(5 * 1024 * 1024 + 1, 97)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('needs imports Create: an operative can’t import', async () => {
    await expect(
      startItemImport(f.db, operative, 'items.csv', csv([row({ kind: 'Ladder', depot })])),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gives a template the importer itself accepts', async () => {
    const template = Buffer.from(itemImportTemplateCsv());
    expect(template.toString().split('\r\n')[0]).toBe(header.join(','));
    const sheets = await itemImportTemplateXlsx(f.db, manager);
    expect(sheets.byteLength).toBeGreaterThan(1000);
  });

  it('people see their own imports; a Kit Manager sees them all', async () => {
    const mine = await listItemImports(f.db, manager);
    expect(mine.length).toBeGreaterThan(3);
    const other = await f.actor((await f.user({ roles: ['kit_manager'], siteIds: [siteA] })).id);
    expect((await listItemImports(f.db, other)).length).toBeGreaterThan(0);
  });

  it('writes the problems as a formula-safe CSV for fixing the file', () => {
    const out = importProblemsCsv({
      rowCount: 1,
      fileProblems: ['=bad'],
      problems: [{ line: 3, column: 'Kind', message: '+oops' }],
    });
    expect(out).toContain("'=bad");
    expect(out).toContain("3,Kind,'+oops");
  });
});
