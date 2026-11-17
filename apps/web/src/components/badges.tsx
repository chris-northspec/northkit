// The shared status pill (S1-9): a colour and always a word, never colour alone, on the
// status colours in tokens.css. Statuses never appear on buttons and never use the
// product accent. Sprints 2 to 4 add their statuses (in store, out, quarantined, missing,
// inspection due) here, so every screen shows them the same way.

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
