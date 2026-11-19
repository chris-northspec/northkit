// UK dates and numbers for the screens (CLAUDE.md: UK English, UK date formats). Due dates
// are day dates in the depot's time zone and are shown as the day, never shifted by the
// viewer's zone; moments (timestamptz) are shown in UK time.

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const moment = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});
const momentYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});

/** A day date (yyyy-mm-dd) as "19 Nov 2026". */
export function ukDay(value: string | null | undefined): string {
  if (!value) return '—';
  return day.format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

/** A moment as "19 Nov, 14:05" (with the year when it isn't this year). */
export function ukMoment(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.getUTCFullYear() === now.getUTCFullYear() ? moment.format(d) : momentYear.format(d);
}

export const n = (value: number): string => value.toLocaleString('en-GB');

export const plural = (value: number, one: string, many = `${one}s`): string =>
  `${n(value)} ${value === 1 ? one : many}`;

/** Whole days from `from` to `to` (a negative number when `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** "3 days ago", "today", "in 2 days". */
export function relativeDays(date: Date, now = new Date()): string {
  const d = daysBetween(now, date);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}
