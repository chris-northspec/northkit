import type { ItemStatus } from '@northkit/core';

// The shared status pill (S1-9, S2-8): a colour and always a word, never colour alone, on
// the status colours in tokens.css. Statuses never appear on buttons and never use the
// product accent, so a new accent drops straight in. Sprints 3 and 4 add the statuses
// they set (out, quarantined, missing, inspection due) here, and every screen shows them
// the same way.

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const cls = (tone: PillTone) => (tone === 'neutral' ? 'badge' : `badge badge-${tone}`);

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: PillTone }) {
  return <span className={cls(tone)}>{label}</span>;
}

export function ArchivedPill() {
  return <StatusPill label="Archived" />;
}

export function InUsePill() {
  return <StatusPill label="In use" tone="success" />;
}

const ITEM_TONES: Record<ItemStatus, { label: string; tone: PillTone }> = {
  available: { label: 'Available', tone: 'success' },
  out: { label: 'Out', tone: 'info' },
  quarantined: { label: 'Quarantined', tone: 'danger' },
  missing: { label: 'Missing', tone: 'warning' },
  retired: { label: 'Retired', tone: 'neutral' },
};

/** An item's status: its own colour set, always with the word. */
export function ItemStatusPill({ status }: { status: ItemStatus }) {
  const s = ITEM_TONES[status];
  return <StatusPill label={s.label} tone={s.tone} />;
}
