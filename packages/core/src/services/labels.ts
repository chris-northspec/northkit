import { sql, withScope, type Db } from '@northkit/db';
import { signItemCode, verifyItemCode } from '../barcodes/item-codes';
import { renderLabels, type LabelItem, type LabelOptions } from '../barcodes/labels';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError } from '../errors';
import type { ItemFilters } from './items';
import { organisationName } from './organisation';

// Labels (S2-4). Printing needs items.view; replacing a label (so old prints stop working)
// needs items.edit. A scan with no login resolves to the kind and asset number only
// (resolveItemLabel): the same answer, and nothing more, for an old label, a forged code
// and a code that was never made.

export const MAX_LABELS_PER_PDF = 2_000;

export interface ScanResult {
  assetNumber: string;
  kindName: string;
  itemId: string;
}

/** What a scanned code points at, for anyone. Null if invalid, forged or replaced. */
export async function resolveItemLabel(db: Db, code: string): Promise<ScanResult | null> {
  const claim = verifyItemCode(code);
  if (!claim) return null;
  const { rows } = await sql<{ asset_number: string; kind_name: string }>`
    SELECT asset_number, kind_name FROM register.resolve_label(${claim.itemId}::uuid, ${claim.version}::smallint)`.execute(
    db,
  );
  const row = rows[0];
  return row
    ? { assetNumber: row.asset_number, kindName: row.kind_name, itemId: claim.itemId }
    : null;
}

const NONE = '00000000-0000-0000-0000-000000000000';

async function labelItems(
  db: Db,
  actor: ActorContext,
  ids: readonly string[] | null,
  filters: ItemFilters,
): Promise<LabelItem[]> {
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    let q = tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .select([
        'i.id',
        'i.asset_number as assetNumber',
        'k.name as kindName',
        'i.label_version as labelVersion',
      ])
      .where('i.status', '<>', 'retired')
      .orderBy('i.asset_number')
      .limit(MAX_LABELS_PER_PDF);
    if (ids) q = q.where('i.id', 'in', ids.length ? [...ids] : [NONE]);
    else {
      if (filters.kindId) q = q.where('i.kind_id', '=', filters.kindId);
      if (filters.siteId) q = q.where('i.site_id', '=', filters.siteId);
      if (filters.status) q = q.where('i.status', '=', filters.status);
      if (filters.ownership) q = q.where('i.ownership', '=', filters.ownership);
      const search = filters.q?.trim();
      if (search) {
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        q = q.where((eb) =>
          eb.or([
            eb('i.asset_number', 'ilike', like),
            eb('i.serial_number', 'ilike', like),
            eb('i.make', 'ilike', like),
            eb('i.model', 'ilike', like),
          ]),
        );
      }
      if (filters.kits === 'kits') q = q.where('i.is_kit', '=', true);
      if (filters.kits === 'in_kit') q = q.where('i.parent_id', 'is not', null);
    }
    return q.execute();
  });
}

/** A PDF of labels for named items, or for every item a filter matches (retired items get none). */
export async function printLabels(
  db: Db,
  actor: ActorContext,
  selection: { ids: readonly string[] } | { filters: ItemFilters },
  options: Omit<LabelOptions, 'companyName'> & { showCompany?: boolean },
): Promise<{ pdf: Buffer; count: number }> {
  requirePermission(actor, 'items.view');
  const items = await labelItems(
    db,
    actor,
    'ids' in selection ? selection.ids : null,
    'filters' in selection ? selection.filters : {},
  );
  const companyName = options.showCompany ? await organisationName(db) : null;
  const pdf = await renderLabels(items, { ...options, companyName });
  return { pdf, count: items.length };
}

/** Replaces a lost, copied or damaged label: every older print stops working. */
export async function replaceItemLabel(db: Db, actor: ActorContext, itemId: string): Promise<void> {
  requirePermission(actor, 'items.edit');
  await withScope(db, scopeOf(actor), async (tx) => {
    const r = await tx
      .updateTable('register.items')
      .set({ label_version: sql<number>`label_version + 1` })
      .where('id', '=', itemId)
      .where('status', '<>', 'retired')
      .executeTakeFirst();
    if (r.numUpdatedRows === 0n) throw new NotFoundError('Item not found.');
  });
}

/** The code for one item's current label. */
export async function itemLabelCode(db: Db, actor: ActorContext, itemId: string): Promise<string> {
  requirePermission(actor, 'items.view');
  const row = await withScope(db, { ...scopeOf(actor), readOnly: true }, (tx) =>
    tx
      .selectFrom('register.items')
      .select('label_version')
      .where('id', '=', itemId)
      .executeTakeFirst(),
  );
  if (!row) throw new NotFoundError('Item not found.');
  return signItemCode(itemId, row.label_version);
}
