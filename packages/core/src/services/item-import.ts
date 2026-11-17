import { randomUUID } from 'node:crypto';
import { sql, withScope, type Db, type ItemImport, type Tx } from '@northkit/db';
import { loadActor } from '../auth/sessions';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';
import { readStored, removeStored, writeStored } from '../files/storage';
import { MAX_WORKBOOK_BYTES, readFirstSheet, writeWorkbook } from '../files/xlsx-io';
import { itemInputSchema, nextAssetNumber, type ItemValues } from './items';
import { parseCsv, toCsv } from './csv';

// Spreadsheet import of items (S2-5, IM-1), the pattern of ClearRate's importer:
//   - CSV and Excel (.xlsx); a formula is never run (the reader takes the saved value), and
//     macro workbooks are refused
//   - a template to download; columns by header name
//   - EVERY problem is listed by row and column before anything is stored, and the import
//     is all or nothing: one bad row stores nothing
//   - kinds and depots are matched by name (a depot by code or name), locations by code;
//     a name that doesn't exist is an error, not a new record
//   - duplicate asset numbers are refused, against the database and inside the file
//   - kit sets come in with a "parent asset number" column
//   - small files are checked and stored in the request; larger ones are queued for the
//     worker. Every stored item is audited, and so is the import itself.

export const ITEM_IMPORT_COLUMNS = [
  'asset_number',
  'kind',
  'depot',
  'serial_number',
  'make',
  'model',
  'description',
  'purchase_date',
  'cost',
  'ownership',
  'hire_company',
  'hire_reference',
  'off_hire_date',
  'location',
  'is_kit',
  'parent_asset_number',
  'notes',
] as const;
type Column = (typeof ITEM_IMPORT_COLUMNS)[number];
const REQUIRED: readonly Column[] = ['kind', 'depot'];

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_BYTES = MAX_WORKBOOK_BYTES;
/** Files up to this size are checked and stored in the request; larger ones wait for the worker. */
export const INLINE_IMPORT_BYTES = 150 * 1024;

export interface ImportProblem {
  /** Line (CSV) or row (Excel) in the file; the header is 1. 0 for a problem with the file itself. */
  line: number;
  column: string;
  message: string;
}

export interface ImportReport {
  rowCount: number;
  fileProblems: string[];
  problems: ImportProblem[];
}

const HEADINGS: Record<Column, string> = {
  asset_number: 'Asset number',
  kind: 'Kind',
  depot: 'Depot',
  serial_number: 'Serial number',
  make: 'Make',
  model: 'Model',
  description: 'Description',
  purchase_date: 'Purchase date',
  cost: 'Cost',
  ownership: 'Ownership',
  hire_company: 'Hire company',
  hire_reference: 'Hire reference',
  off_hire_date: 'Off-hire date',
  location: 'Location',
  is_kit: 'Is a kit',
  parent_asset_number: 'Parent asset number',
  notes: 'Notes',
};

/** Which import column an item field belongs to, for error messages. */
const FIELD_COLUMN: Record<string, Column> = {
  siteId: 'depot',
  kindId: 'kind',
  assetNumber: 'asset_number',
  serialNumber: 'serial_number',
  make: 'make',
  model: 'model',
  description: 'description',
  purchaseDate: 'purchase_date',
  cost: 'cost',
  ownership: 'ownership',
  hireCompany: 'hire_company',
  hireReference: 'hire_reference',
  offHireDate: 'off_hire_date',
  locationId: 'location',
  isKit: 'is_kit',
  notes: 'notes',
};

const EXAMPLES: string[][] = [
  [
    '',
    'Ladder',
    'ASH',
    'LD-7741',
    'Examplo',
    'TE-3x9',
    'Triple extension ladder',
    '2024-03-01',
    '189.50',
    'owned',
    '',
    '',
    '',
    'ASH-YARD',
    'no',
    '',
    '',
  ],
  [
    '',
    'Harness',
    'ASH',
    '',
    'Examplo',
    'FB-2',
    'Full-body harness set',
    '01/06/2025',
    '320',
    'hired in',
    'Example Hire Ltd',
    'H-1042',
    '2027-06-01',
    'ASH-VAN1',
    'yes',
    '',
    'A kit: list its parts below with this row’s asset number',
  ],
];

/** A template: the header and two fictional example rows, as CSV text. */
export function itemImportTemplateCsv(): string {
  return toCsv([[...ITEM_IMPORT_COLUMNS], ...EXAMPLES]);
}

/** The template as an Excel workbook, with a second sheet listing the kinds and depots to use. */
export async function itemImportTemplateXlsx(db: Db, actor: ActorContext): Promise<Buffer> {
  requirePermission(actor, 'imports.view');
  const lookups = await loadLookups(db, actor);
  return writeWorkbook([
    {
      name: 'Items',
      header: [...ITEM_IMPORT_COLUMNS],
      rows: EXAMPLES,
      widths: ITEM_IMPORT_COLUMNS.map(() => 18),
    },
    {
      name: 'Kinds and depots',
      header: ['Kinds you can use', 'Depots you can use (code)', 'Depot name'],
      rows: Array.from({ length: Math.max(lookups.kinds.length, lookups.sites.length) }, (_, i) => [
        lookups.kinds[i]?.name ?? null,
        lookups.sites[i]?.code ?? null,
        lookups.sites[i]?.name ?? null,
      ]),
      widths: [28, 24, 32],
    },
  ]);
}

interface Lookups {
  kinds: { id: string; name: string; active: boolean }[];
  sites: { id: string; code: string; name: string }[];
}

async function loadLookups(db: Db, actor: ActorContext): Promise<Lookups> {
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => ({
    kinds: await tx
      .selectFrom('register.kinds')
      .select(['id', 'name', 'active'])
      .orderBy('name')
      .execute(),
    sites: await tx
      .selectFrom('core.sites')
      .select(['id', 'code', 'name'])
      .where('archived_at', 'is', null)
      .orderBy('code')
      .execute(),
  }));
}

/** dd/mm/yyyy (UK) or yyyy-mm-dd to yyyy-mm-dd; anything else is passed through to fail validation. */
function dateText(text: string): string {
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  return uk ? `${uk[3]}-${uk[2]!.padStart(2, '0')}-${uk[1]!.padStart(2, '0')}` : text.trim();
}

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0', '']);

export interface PlannedItem {
  line: number;
  values: ItemValues;
  parentAssetNumber: string | null;
}

interface Analysis {
  report: ImportReport;
  planned: PlannedItem[];
}

interface RawRow {
  line: number;
  cells: Record<Column, string>;
}

/** Turns a CSV or Excel file into rows keyed by column, or says why it can't. */
async function readRows(
  file: Buffer,
  format: 'csv' | 'xlsx',
): Promise<{ rows: RawRow[]; fileProblems: string[]; unknown: string[] }> {
  let header: string[];
  let body: { line: number; cells: (string | null)[] }[];
  try {
    if (format === 'xlsx') {
      const sheet = await readFirstSheet(file);
      header = sheet.header;
      body = sheet.rows.map((r) => ({ line: r.row, cells: r.cells }));
    } else {
      const parsed = parseCsv(file.toString('utf8'));
      const [head, ...rest] = parsed;
      if (!head) return { rows: [], fileProblems: ['The file is empty.'], unknown: [] };
      header = head.cells.map((c) => c.trim());
      body = rest.map((r) => ({ line: r.line, cells: r.cells }));
    }
  } catch (error) {
    return { rows: [], fileProblems: [(error as Error).message], unknown: [] };
  }
  const cols = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_'),
  );
  const fileProblems: string[] = [];
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length)
    fileProblems.push(
      `The header row needs these columns: ${missing.join(', ')}. Use the template.`,
    );
  const unknown = cols.filter((c) => c && !(ITEM_IMPORT_COLUMNS as readonly string[]).includes(c));
  if (unknown.length)
    fileProblems.push(`Unknown columns: ${unknown.join(', ')}. Use the template, or delete them.`);
  if (body.length === 0) fileProblems.push('The file has a header but no rows.');
  if (body.length > MAX_IMPORT_ROWS)
    fileProblems.push(
      `The file has ${body.length.toLocaleString('en-GB')} rows; import at most ${MAX_IMPORT_ROWS.toLocaleString('en-GB')} at a time.`,
    );
  if (fileProblems.length) return { rows: [], fileProblems, unknown };
  const index = new Map(ITEM_IMPORT_COLUMNS.map((c) => [c, cols.indexOf(c)]));
  const rows = body
    .filter((r) => r.cells.some((c) => (c ?? '').trim() !== ''))
    .map((r) => ({
      line: r.line,
      cells: Object.fromEntries(
        ITEM_IMPORT_COLUMNS.map((c) => [
          c,
          index.get(c)! >= 0 ? (r.cells[index.get(c)!] ?? '').toString().trim() : '',
        ]),
      ) as Record<Column, string>,
    }));
  return { rows, fileProblems: [], unknown };
}

/** Checks every row and builds the plan; writes nothing. */
export async function analyseItemImport(
  db: Db,
  actor: ActorContext,
  file: Buffer,
  format: 'csv' | 'xlsx',
): Promise<Analysis> {
  const { rows, fileProblems } = await readRows(file, format);
  if (fileProblems.length)
    return { report: { rowCount: rows.length, fileProblems, problems: [] }, planned: [] };

  const lookups = await loadLookups(db, actor);
  const kindByName = new Map(lookups.kinds.map((k) => [k.name.toLowerCase(), k]));
  const siteByKey = new Map<string, Lookups['sites'][number]>();
  for (const s of lookups.sites) {
    siteByKey.set(s.code.toLowerCase(), s);
    siteByKey.set(s.name.toLowerCase(), s);
  }
  // Locations by depot and code, for the depots involved.
  const locations = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx
      .selectFrom('core.locations')
      .select(['id', 'site_id', 'code'])
      .where('archived_at', 'is', null)
      .execute(),
  );
  const locationKey = new Map(locations.map((l) => [`${l.site_id}|${l.code.toLowerCase()}`, l.id]));

  const typed = [...new Set(rows.map((r) => r.cells.asset_number.toUpperCase()).filter(Boolean))];
  const taken = new Set<string>(
    typed.length
      ? ((
          await sql<{
            t: string[];
          }>`SELECT register.asset_numbers_taken(${typed}::text[]) AS t`.execute(db)
        ).rows[0]?.t ?? [])
      : [],
  );

  const problems: ImportProblem[] = [];
  const planned: PlannedItem[] = [];
  const firstLine = new Map<string, number>();
  const kitLines = new Map<string, { line: number; siteId: string; isKit: boolean }>();

  for (const { line, cells } of rows) {
    const here: ImportProblem[] = [];
    const bad = (column: Column, message: string) =>
      here.push({ line, column: HEADINGS[column], message });

    const kind = kindByName.get(cells.kind.toLowerCase());
    if (!cells.kind) bad('kind', 'Enter a kind.');
    else if (!kind)
      bad(
        'kind',
        `There is no kind called “${cells.kind}”. Add it under Kinds first, or use one from the template.`,
      );
    else if (!kind.active) bad('kind', `The kind “${kind.name}” is deactivated.`);

    const site = siteByKey.get(cells.depot.toLowerCase());
    if (!cells.depot) bad('depot', 'Enter a depot code or name.');
    else if (!site)
      bad('depot', `There is no depot “${cells.depot}” among the depots you work at.`);

    const locationText = cells.location;
    let locationId: string | null = null;
    if (locationText && site) {
      locationId = locationKey.get(`${site.id}|${locationText.toLowerCase()}`) ?? null;
      if (!locationId)
        bad('location', `There is no location with code “${locationText}” at depot ${site.code}.`);
    }

    const ownershipText = cells.ownership.toLowerCase().replace(/[\s_-]+/g, '');
    const ownership =
      ownershipText === '' || ownershipText === 'owned'
        ? 'owned'
        : ownershipText === 'hiredin' || ownershipText === 'hired'
          ? 'hired_in'
          : null;
    if (ownership === null) bad('ownership', 'Use “owned” or “hired in”.');

    const kitText = cells.is_kit.toLowerCase();
    if (!YES.has(kitText) && !NO.has(kitText)) bad('is_kit', 'Use “yes” or “no”.');

    const result = itemInputSchema.safeParse({
      siteId: site?.id ?? '00000000-0000-4000-8000-000000000000',
      kindId: kind?.id ?? '00000000-0000-4000-8000-000000000000',
      assetNumber: cells.asset_number,
      serialNumber: cells.serial_number,
      make: cells.make,
      model: cells.model,
      description: cells.description,
      purchaseDate: dateText(cells.purchase_date),
      cost: cells.cost,
      ownership: ownership ?? 'owned',
      hireCompany: cells.hire_company,
      hireReference: cells.hire_reference,
      offHireDate: dateText(cells.off_hire_date),
      locationId,
      isKit: YES.has(kitText),
      notes: cells.notes,
    });
    if (!result.success)
      for (const issue of result.error.issues) {
        const column = FIELD_COLUMN[String(issue.path[0])] ?? 'notes';
        // Lookup failures were already reported against kind and depot, in plainer words.
        if (
          (column === 'kind' && (!kind || !kind.active)) ||
          (column === 'depot' && !site) ||
          (column === 'ownership' && ownership === null)
        )
          continue;
        bad(column, issue.message);
      }

    const number = cells.asset_number.toUpperCase();
    if (number) {
      if (taken.has(number))
        bad('asset_number', `Asset number ${number} is already used by another item.`);
      const earlier = firstLine.get(number);
      if (earlier !== undefined)
        bad('asset_number', `Asset number ${number} is also on line ${earlier}.`);
      else firstLine.set(number, line);
    }

    if (here.length) problems.push(...here);
    else if (result.success) {
      planned.push({
        line,
        values: result.data,
        parentAssetNumber: cells.parent_asset_number.toUpperCase() || null,
      });
      if (number) kitLines.set(number, { line, siteId: site!.id, isKit: result.data.isKit });
    }
  }

  // Kit sets: the parent is a kit in this file, or a kit already in the register, at the same depot.
  const parents = [
    ...new Set(planned.map((p) => p.parentAssetNumber).filter((p): p is string => !!p)),
  ];
  const existingKits = new Map<
    string,
    { siteId: string; isKit: boolean; parentId: string | null }
  >();
  if (parents.length) {
    const found = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
      tx
        .selectFrom('register.items')
        .select(['asset_number', 'site_id', 'is_kit', 'parent_id'])
        .where(sql<boolean>`upper(asset_number) = ANY(${parents}::text[])`)
        .execute(),
    );
    for (const f of found)
      existingKits.set(f.asset_number.toUpperCase(), {
        siteId: f.site_id,
        isKit: f.is_kit,
        parentId: f.parent_id,
      });
  }
  const survivors: PlannedItem[] = [];
  for (const p of planned) {
    const parent = p.parentAssetNumber;
    if (!parent) {
      survivors.push(p);
      continue;
    }
    const inFile = kitLines.get(parent);
    const inDb = existingKits.get(parent);
    const parentSite = inFile?.siteId ?? inDb?.siteId;
    const parentIsKit = inFile ? inFile.isKit : inDb?.isKit;
    const fail = (message: string) =>
      problems.push({ line: p.line, column: HEADINGS.parent_asset_number, message });
    if (parentSite === undefined)
      fail(`There is no item with asset number ${parent}, in this file or in the register.`);
    else if (!parentIsKit) fail(`${parent} is not a kit: put “yes” in its “Is a kit” column.`);
    else if (parentSite !== p.values.siteId)
      fail(`${parent} is at a different depot: a kit holds only items from its own depot.`);
    else if (p.values.isKit) fail('A kit can’t be inside another kit.');
    else survivors.push(p);
  }
  problems.sort((a, b) => a.line - b.line);
  return {
    report: { rowCount: rows.length, fileProblems: [], problems },
    planned: problems.length ? [] : survivors,
  };
}

/** Stores every planned item in one transaction. Nothing is stored if anything fails. */
async function storePlanned(db: Db, actor: ActorContext, planned: PlannedItem[]): Promise<number> {
  return withScope(db, scopeOf(actor), async (tx: Tx) => {
    const ids = new Map<string, string>();
    // Kits first, so their parts can point at them.
    const ordered = [
      ...planned.filter((p) => p.values.isKit),
      ...planned.filter((p) => !p.values.isKit),
    ];
    for (const p of ordered) {
      const v = p.values;
      const assetNumber = v.assetNumber || (await nextAssetNumber(tx, db, v.kindId));
      let parentId: string | null = null;
      if (p.parentAssetNumber) {
        parentId =
          ids.get(p.parentAssetNumber) ??
          (
            await tx
              .selectFrom('register.items')
              .select('id')
              .where(sql<boolean>`upper(asset_number) = ${p.parentAssetNumber}`)
              .executeTakeFirstOrThrow()
          ).id;
      }
      const row = await tx
        .insertInto('register.items')
        .values({
          site_id: v.siteId,
          kind_id: v.kindId,
          asset_number: assetNumber,
          serial_number: v.serialNumber,
          make: v.make,
          model: v.model,
          description: v.description,
          purchase_date: v.purchaseDate,
          cost_pence: v.cost,
          ownership: v.ownership,
          hire_company: v.ownership === 'hired_in' ? v.hireCompany : null,
          hire_reference: v.ownership === 'hired_in' ? v.hireReference : null,
          off_hire_date: v.ownership === 'hired_in' ? v.offHireDate : null,
          location_id: v.locationId,
          is_kit: v.isKit,
          parent_id: parentId,
          notes: v.notes,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (v.assetNumber) ids.set(v.assetNumber, row.id);
    }
    return planned.length;
  });
}

// ---------------------------------------------------------------- import records

export interface ImportSummary extends ItemImport {
  /** Parsed report, for screens. */
  parsed: ImportReport;
}

function summarise(row: ItemImport): ImportSummary {
  const r = (row.report ?? {}) as Partial<ImportReport>;
  return {
    ...row,
    parsed: {
      rowCount: r.rowCount ?? row.row_count,
      fileProblems: r.fileProblems ?? [],
      problems: r.problems ?? [],
    },
  };
}

function fileFormat(name: string, bytes: Buffer): 'csv' | 'xlsx' {
  const lower = name.toLowerCase();
  if (/\.(xlsm|xlsb|xls|xltm)$/.test(lower))
    throw new ValidationError(
      'Macro workbooks and old Excel formats aren’t read. Save the sheet as .xlsx or .csv.',
      { file: 'Use a .csv or .xlsx file.' },
    );
  const zip =
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (lower.endsWith('.xlsx')) {
    if (!zip)
      throw new ValidationError('That isn’t an Excel (.xlsx) file.', {
        file: 'The file isn’t a real .xlsx workbook.',
      });
    return 'xlsx';
  }
  if (lower.endsWith('.csv')) {
    if (zip || bytes.includes(0))
      throw new ValidationError('That isn’t a CSV file.', { file: 'The file isn’t a text CSV.' });
    return 'csv';
  }
  throw new ValidationError('Upload a CSV (.csv) or Excel (.xlsx) file.', {
    file: 'Use a .csv or .xlsx file.',
  });
}

/** Keeps an uploaded file and queues its check. Returns the record; call processImport to run it. */
export async function startItemImport(
  db: Db,
  actor: ActorContext,
  fileName: string,
  bytes: Buffer,
): Promise<ImportSummary> {
  requirePermission(actor, 'imports.create');
  requirePermission(actor, 'items.create');
  if (bytes.length === 0)
    throw new ValidationError('That file is empty.', { file: 'Choose a file.' });
  if (bytes.length > MAX_IMPORT_BYTES)
    throw new ValidationError('That file is larger than 5 MB.', {
      file: 'Split it and import each part.',
    });
  const format = fileFormat(fileName, bytes);
  const stored = `${randomUUID()}.${format}`;
  await writeStored(`imports/${stored}`, bytes);
  const row = await withScope(db, scopeOf(actor), (tx) =>
    tx
      .insertInto('register.imports')
      .values({
        file_name: fileName.slice(-200),
        file_format: format,
        stored_name: stored,
        byte_size: bytes.length,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  return summarise(row);
}

async function loadImportRow(db: Db, id: string): Promise<ItemImport> {
  const row = await db
    .selectFrom('register.imports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('Import not found.');
  return row;
}

/** The person who made an import, as an actor (the worker acts as them). */
async function actorFor(db: Db, userId: string): Promise<ActorContext> {
  const user = await db
    .selectFrom('core.users')
    .select(['all_sites', 'archived_at'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.archived_at)
    throw new ValidationError('The person who started this import no longer has access.');
  return db.transaction().execute((tx) => loadActor(tx, userId, { allSites: user.all_sites }));
}

async function setStatus(
  db: Db,
  actor: ActorContext,
  id: string,
  set: Record<string, unknown>,
): Promise<void> {
  await withScope(db, scopeOf(actor), (tx) =>
    tx.updateTable('register.imports').set(set).where('id', '=', id).execute(),
  );
}

/** Checks a queued import and records the report: 'problems' or 'ready'. Nothing is stored. */
export async function checkItemImport(db: Db, importId: string): Promise<ImportSummary> {
  const record = await loadImportRow(db, importId);
  if (record.status !== 'queued') return summarise(record);
  const actor = await actorFor(db, record.created_by!);
  await setStatus(db, actor, importId, { status: 'checking' });
  try {
    const file = await readStored(`imports/${record.stored_name}`);
    const { report } = await analyseItemImport(db, actor, file, record.file_format);
    const clean = report.fileProblems.length === 0 && report.problems.length === 0;
    await setStatus(db, actor, importId, {
      status: clean ? 'ready' : 'problems',
      row_count: report.rowCount,
      report: JSON.stringify(report),
    });
  } catch (error) {
    await setStatus(db, actor, importId, {
      status: 'failed',
      error: (error as Error).message.slice(0, 1000),
    });
  }
  return summarise(await loadImportRow(db, importId));
}

/** Asks for a clean import to be stored. The worker does it, or processImport does it at once. */
export async function requestItemImportLoad(
  db: Db,
  actor: ActorContext,
  importId: string,
): Promise<void> {
  requirePermission(actor, 'imports.create');
  await withScope(db, scopeOf(actor), async (tx) => {
    const row = await tx
      .selectFrom('register.imports')
      .select(['status', 'created_by'])
      .where('id', '=', importId)
      .executeTakeFirst();
    if (!row) throw new NotFoundError('Import not found.');
    if (row.status !== 'ready')
      throw new ValidationError(
        'Only a file with no problems can be stored. Fix the problems and upload it again.',
      );
    await tx
      .updateTable('register.imports')
      .set({ status: 'loading' })
      .where('id', '=', importId)
      .execute();
  });
}

/**
 * Stores a clean import, all or nothing. The check runs again first: kinds, depots or
 * numbers may have changed since it was checked, and a file that is no longer clean stores
 * nothing.
 */
export async function loadItemImport(db: Db, importId: string): Promise<ImportSummary> {
  const record = await loadImportRow(db, importId);
  if (record.status !== 'loading') return summarise(record);
  const actor = await actorFor(db, record.created_by!);
  try {
    const file = await readStored(`imports/${record.stored_name}`);
    const { report, planned } = await analyseItemImport(db, actor, file, record.file_format);
    if (report.fileProblems.length || report.problems.length) {
      await setStatus(db, actor, importId, { status: 'problems', report: JSON.stringify(report) });
    } else {
      const n = await storePlanned(db, actor, planned);
      await setStatus(db, actor, importId, {
        status: 'loaded',
        items_loaded: n,
        report: JSON.stringify(report),
      });
      await removeStored(`imports/${record.stored_name}`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    await setStatus(db, actor, importId, {
      status: code === '23505' ? 'problems' : 'failed',
      error:
        code === '23505'
          ? 'An asset number was used by someone else while this was importing. Nothing was stored; check the file again.'
          : (error as Error).message.slice(0, 1000),
    });
  }
  return summarise(await loadImportRow(db, importId));
}

/** Check a queued import and, for the `then` option, store it too: used by the web for small files. */
export async function processItemImport(db: Db, importId: string): Promise<ImportSummary> {
  const checked = await checkItemImport(db, importId);
  return checked;
}

/** The worker: checks queued imports and stores the ones people asked for. Returns how many it handled. */
export async function runItemImports(db: Db): Promise<number> {
  const queued = await db
    .selectFrom('register.imports')
    .select('id')
    .where('status', '=', 'queued')
    .orderBy('created_at')
    .limit(5)
    .execute();
  for (const r of queued) await checkItemImport(db, r.id);
  const loading = await db
    .selectFrom('register.imports')
    .select('id')
    .where('status', '=', 'loading')
    .orderBy('created_at')
    .limit(5)
    .execute();
  for (const r of loading) await loadItemImport(db, r.id);
  return queued.length + loading.length;
}

export async function listItemImports(db: Db, actor: ActorContext): Promise<ImportSummary[]> {
  requirePermission(actor, 'imports.view');
  const rows = await db
    .selectFrom('register.imports')
    .selectAll()
    .$if(!actor.administrator && !actor.permissions.has('items.approve'), (q) =>
      q.where('created_by', '=', actor.userId),
    )
    .orderBy('created_at', 'desc')
    .limit(30)
    .execute();
  return rows.map(summarise);
}

export async function getItemImport(
  db: Db,
  actor: ActorContext,
  id: string,
): Promise<ImportSummary> {
  requirePermission(actor, 'imports.view');
  const row = await loadImportRow(db, id);
  if (
    row.created_by !== actor.userId &&
    !actor.administrator &&
    !actor.permissions.has('items.approve')
  )
    throw new NotFoundError('Import not found.');
  return summarise(row);
}

/** The problems as CSV, for fixing the file (formula-safe). */
export function importProblemsCsv(report: ImportReport): string {
  const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  return `﻿${toCsv([
    ['line', 'column', 'problem'],
    ...report.fileProblems.map((p) => ['', '', safe(p)]),
    ...report.problems.map((p) => [p.line, p.column, safe(p.message)]),
  ])}`;
}
