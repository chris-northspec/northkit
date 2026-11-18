import {
  RULE_TYPES,
  sql,
  withScope,
  type Db,
  type Kind,
  type KindRule,
  type RuleType,
} from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { ConflictError, NotFoundError } from '../errors';
import { isUniqueViolation, parse } from './validation';

// Kinds of item and the inspection rules each carries (S2-1, IT-1). Data only: Sprint 4
// builds schedules and records from the rules. The rules are the customer's own schedule
// settings, editable defaults, not legal advice (ADR 0003). Viewing needs items.view;
// changing a kind or its rules needs items.approve (Kit Manager and Administrator).

export { RULE_TYPES };
export type { RuleType };

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  loler: 'LOLER thorough examination',
  puwer: 'PUWER inspection',
  pat: 'PAT test',
  calibration: 'Calibration',
  pre_use: 'Pre-use check',
  other: 'Other',
};

/** Said wherever rules are shown: they are the customer's settings (ADR 0003). */
export const KIND_RULES_NOTICE =
  'These are your own schedule settings, editable defaults. They are not legal advice: confirm them with a competent person. NorthKit stores your records and reminds you when they are due; it never performs or certifies an examination.';

export const kindInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
  description: z
    .string()
    .trim()
    .max(1000, 'Use 1,000 characters or fewer.')
    .transform((v) => v || null)
    .prefault(''),
  assetPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v || null)
    .refine(
      (v) => v === null || /^[A-Z][A-Z0-9]{0,7}$/.test(v),
      'Use up to 8 capital letters or digits, starting with a letter.',
    )
    .prefault(''),
});
export type KindInput = z.input<typeof kindInputSchema>;

export const ruleInputSchema = z.object({
  ruleType: z.enum(RULE_TYPES, { message: 'Choose a type.' }),
  title: z.string().trim().min(1, 'Enter a name.').max(100, 'Use 100 characters or fewer.'),
  intervalValue: z.coerce
    .number({ message: 'Enter a whole number.' })
    .int('Enter a whole number.')
    .min(1, 'Use 1 or more.')
    .max(1200, 'Use 1,200 or fewer.'),
  intervalUnit: z.enum(['days', 'months'], { message: 'Choose days or months.' }),
  required: z.boolean().default(false),
  note: z
    .string()
    .trim()
    .max(1000, 'Use 1,000 characters or fewer.')
    .transform((v) => v || null)
    .prefault(''),
});
export type RuleInput = z.input<typeof ruleInputSchema>;

export interface KindWithRules extends Kind {
  rules: KindRule[];
  /** Items of this kind (live and retired). */
  itemCount: number;
}

async function loadKinds(
  db: Db,
  actor: ActorContext,
  where: { id?: string; activeOnly?: boolean },
): Promise<KindWithRules[]> {
  return withScope(db, scopeOf(actor), async (tx) => {
    let q = tx
      .selectFrom('register.kinds as k')
      .selectAll('k')
      .select(
        sql<number>`(SELECT count(*) FROM register.items i WHERE i.kind_id = k.id)::int`.as(
          'item_count',
        ),
      )
      .orderBy(sql`lower(k.name)`);
    if (where.id) q = q.where('k.id', '=', where.id);
    if (where.activeOnly) q = q.where('k.active', '=', true);
    const kinds = await q.execute();
    if (kinds.length === 0) return [];
    const rules = await tx
      .selectFrom('register.kind_rules')
      .selectAll()
      .where(
        'kind_id',
        'in',
        kinds.map((k) => k.id),
      )
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    return kinds.map(({ item_count, ...k }) => ({
      ...k,
      itemCount: item_count,
      rules: rules.filter((r) => r.kind_id === k.id),
    }));
  });
}

/** Every kind with its rules, alphabetical. */
export async function listKinds(
  db: Db,
  actor: ActorContext,
  options: { activeOnly?: boolean } = {},
): Promise<KindWithRules[]> {
  requirePermission(actor, 'items.view');
  return loadKinds(db, actor, options);
}

export async function getKind(db: Db, actor: ActorContext, id: string): Promise<KindWithRules> {
  requirePermission(actor, 'items.view');
  const [kind] = await loadKinds(db, actor, { id });
  if (!kind) throw new NotFoundError('Kind not found.');
  return kind;
}

export async function createKind(db: Db, actor: ActorContext, input: KindInput): Promise<Kind> {
  requirePermission(actor, 'items.approve');
  const v = parse(kindInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), (tx) =>
      tx
        .insertInto('register.kinds')
        .values({ name: v.name, description: v.description, asset_prefix: v.assetPrefix })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A kind with that name already exists.');
    throw error;
  }
}

export async function updateKind(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  input: KindInput,
): Promise<Kind> {
  requirePermission(actor, 'items.approve');
  const v = parse(kindInputSchema, input);
  try {
    return await withScope(db, scopeOf(actor), async (tx) => {
      const row = await tx
        .updateTable('register.kinds')
        .set({ name: v.name, description: v.description, asset_prefix: v.assetPrefix })
        .where('id', '=', id)
        .where('row_version', '=', rowVersion)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw new ConflictError('Someone else changed this kind. Reload and try again.');
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A kind with that name already exists.');
    throw error;
  }
}

/** Deactivating keeps every existing item; new items can't use the kind. */
export async function setKindActive(
  db: Db,
  actor: ActorContext,
  id: string,
  rowVersion: number,
  active: boolean,
): Promise<void> {
  requirePermission(actor, 'items.approve');
  await withScope(db, scopeOf(actor), async (tx) => {
    const r = await tx
      .updateTable('register.kinds')
      .set({ active })
      .where('id', '=', id)
      .where('row_version', '=', rowVersion)
      .executeTakeFirst();
    if (r.numUpdatedRows === 0n)
      throw new ConflictError('Someone else changed this kind. Reload and try again.');
  });
}

/** Deletes a kind nothing uses; a kind in use is refused by the database. */
export async function deleteKind(db: Db, actor: ActorContext, id: string): Promise<void> {
  requirePermission(actor, 'items.approve');
  try {
    await withScope(db, scopeOf(actor), async (tx) => {
      const r = await tx.deleteFrom('register.kinds').where('id', '=', id).executeTakeFirst();
      if (r.numDeletedRows === 0n) throw new NotFoundError('Kind not found.');
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23503')
      throw new ConflictError(
        'This kind is in use by items, so it can’t be deleted. Deactivate it instead.',
      );
    throw error;
  }
}

export async function addKindRule(
  db: Db,
  actor: ActorContext,
  kindId: string,
  input: RuleInput,
): Promise<KindRule> {
  requirePermission(actor, 'items.approve');
  const v = parse(ruleInputSchema, input);
  return withScope(db, scopeOf(actor), async (tx) => {
    const kind = await tx
      .selectFrom('register.kinds')
      .select('id')
      .where('id', '=', kindId)
      .executeTakeFirst();
    if (!kind) throw new NotFoundError('Kind not found.');
    const last = await tx
      .selectFrom('register.kind_rules')
      .select(sql<number>`coalesce(max(sort_order), 0)`.as('n'))
      .where('kind_id', '=', kindId)
      .executeTakeFirstOrThrow();
    return tx
      .insertInto('register.kind_rules')
      .values({
        kind_id: kindId,
        rule_type: v.ruleType,
        title: v.title,
        interval_value: v.intervalValue,
        interval_unit: v.intervalUnit,
        required: v.required,
        note: v.note,
        sort_order: last.n + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
}

export async function updateKindRule(
  db: Db,
  actor: ActorContext,
  ruleId: string,
  rowVersion: number,
  input: RuleInput,
): Promise<KindRule> {
  requirePermission(actor, 'items.approve');
  const v = parse(ruleInputSchema, input);
  return withScope(db, scopeOf(actor), async (tx) => {
    const row = await tx
      .updateTable('register.kind_rules')
      .set({
        rule_type: v.ruleType,
        title: v.title,
        interval_value: v.intervalValue,
        interval_unit: v.intervalUnit,
        required: v.required,
        note: v.note,
      })
      .where('id', '=', ruleId)
      .where('row_version', '=', rowVersion)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictError('Someone else changed this rule. Reload and try again.');
    return row;
  });
}

export async function removeKindRule(db: Db, actor: ActorContext, ruleId: string): Promise<void> {
  requirePermission(actor, 'items.approve');
  await withScope(db, scopeOf(actor), async (tx) => {
    const r = await tx
      .deleteFrom('register.kind_rules')
      .where('id', '=', ruleId)
      .executeTakeFirst();
    if (r.numDeletedRows === 0n) throw new NotFoundError('Rule not found.');
  });
}

/** "6 months", "1 day". */
export function intervalText(value: number, unit: 'days' | 'months'): string {
  const word = unit === 'days' ? 'day' : 'month';
  return `${value} ${word}${value === 1 ? '' : 's'}`;
}
