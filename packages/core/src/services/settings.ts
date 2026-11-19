import { withScope, type Db } from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';

// Organisation-wide settings (S1-3). The database holds key and value (core.settings);
// this file is the list of keys the app understands and what each may hold, so a typo
// or a wild value is refused here, before it can change how reminders or check-outs work.

const reminderDays = z
  .array(z.number().int().min(1, 'Use whole days, 1 or more.').max(365, 'Use 365 days or fewer.'))
  .min(1, 'Give at least one reminder.')
  .max(6, 'Use six reminders or fewer.')
  .refine((days) => new Set(days).size === days.length, 'Each reminder day must be different.')
  .transform((days) => [...days].sort((a, b) => b - a));

export const SETTING_DEFINITIONS = {
  'items.asset_number_prefix': {
    label: 'Prefix for generated asset numbers',
    schema: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z][A-Z0-9]{0,7}$/,
        'Use up to 8 capital letters or digits, starting with a letter.',
      ),
  },
  'reminders.days_before_due': {
    label: 'Reminder days before something falls due',
    schema: reminderDays,
  },
  'checkout.default_days_out': {
    label:
      'Default days out: the due-back date offered at check-out when a kind has none of its own',
    schema: z.number().int().min(1, 'Use 1 day or more.').max(365, 'Use 365 days or fewer.'),
  },
  'stocktake.recount_days': {
    label: 'Days before a location needs counting again',
    schema: z.number().int().min(1, 'Use 1 day or more.').max(730, 'Use 730 days or fewer.'),
  },
  'session.timeout_warning_minutes': {
    label: 'Minutes of warning before an idle session ends',
    schema: z.number().int().min(1, 'Use 1 minute or more.').max(30, 'Use 30 minutes or fewer.'),
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFINITIONS;
}

export type SettingValue<K extends SettingKey> = z.output<
  (typeof SETTING_DEFINITIONS)[K]['schema']
>;

export interface SettingRow {
  key: SettingKey;
  label: string;
  description: string;
  value: unknown;
}

/** Every setting the app knows, with its current value. */
export async function listSettings(db: Db, actor: ActorContext): Promise<SettingRow[]> {
  requirePermission(actor, 'settings.view');
  const rows = await withScope(db, scopeOf(actor), (tx) =>
    tx.selectFrom('core.settings').select(['key', 'value', 'description']).orderBy('key').execute(),
  );
  return rows
    .filter((r) => isSettingKey(r.key))
    .map((r) => ({
      key: r.key as SettingKey,
      label: SETTING_DEFINITIONS[r.key as SettingKey].label,
      description: r.description,
      value: r.value,
    }));
}

/** One setting, validated. Needs no permission: the screens read these to behave. */
export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const row = await db
    .selectFrom('core.settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();
  if (!row) throw new NotFoundError(`Setting ${key} is missing.`);
  return SETTING_DEFINITIONS[key].schema.parse(row.value) as SettingValue<K>;
}

export async function updateSetting(
  db: Db,
  actor: ActorContext,
  key: string,
  value: unknown,
): Promise<void> {
  requirePermission(actor, 'settings.edit');
  if (!isSettingKey(key))
    throw new ValidationError('That setting does not exist.', { key: 'Unknown setting.' });
  const parsed = SETTING_DEFINITIONS[key].schema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError('Check the highlighted fields.', {
      value: parsed.error.issues[0]?.message ?? 'Enter a valid value.',
    });
  await withScope(db, scopeOf(actor), async (tx) => {
    const r = await tx
      .updateTable('core.settings')
      .set({ value: JSON.stringify(parsed.data) })
      .where('key', '=', key)
      .executeTakeFirst();
    if (r.numUpdatedRows === 0n) throw new NotFoundError('Setting not found.');
  });
}
