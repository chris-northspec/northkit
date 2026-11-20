import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

// The v2 building blocks (standard 13): the eyebrow with its tick, the icon chip, the
// stat card, the sparkline, the delta chip and the person with their initials. Server
// components: nothing here needs a browser.

export function Eyebrow({
  children,
  tone,
  id,
}: {
  children: ReactNode;
  tone?: 'hero' | 'danger' | 'warning';
  id?: string;
}) {
  return (
    <p id={id} className={`eyebrow${tone ? ` eyebrow-${tone}` : ''}`}>
      {children}
    </p>
  );
}

export function IconChip({ icon: Icon, neutral = false }: { icon: LucideIcon; neutral?: boolean }) {
  return (
    <span className={`icon-chip${neutral ? ' icon-chip-neutral' : ''}`} aria-hidden="true">
      <Icon size={18} className="icon" />
    </span>
  );
}

/** A card header: an icon chip or an eyebrow, a title, a muted meta line and one quiet action. */
export function CardHead({
  icon,
  eyebrow,
  title,
  meta,
  action,
  headingId,
  level = 2,
}: {
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  headingId?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="card-head">
      {icon ? <IconChip icon={icon} /> : null}
      <div className="card-head-text">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Heading id={headingId} className="card-title">
          {title}
        </Heading>
        {meta ? <p className="card-meta">{meta}</p> : null}
      </div>
      {action ? <div className="card-action">{action}</div> : null}
    </div>
  );
}

const n = (value: number) => value.toLocaleString('en-GB');

export function Delta({
  children,
  tone = 'neutral',
  direction,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'bad' | 'attention';
  direction?: 'up' | 'down';
}) {
  return (
    <span className={`delta${tone === 'neutral' ? '' : ` delta-${tone}`}`}>
      {direction ? <span aria-hidden="true">{direction === 'up' ? '▲' : '▼'}</span> : null}
      {children}
    </span>
  );
}

/**
 * A sparkline from real history. `values` are the figure at the end of each day; `label`
 * is the text alternative ("Items out each day for 14 days: 48 on the first, 61 today").
 */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 40;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const area = `${line} L${pts.at(-1)![0]} ${h} L${pts[0]![0]} ${h} Z`;
  const last = pts.at(-1)!;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path className="spark-area" d={area} />
      <path d={line} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="3" />
    </svg>
  );
}

/**
 * The stat card (standard 13, section 4): an eyebrow, a big figure with its unit, a
 * sparkline where history exists, a dashed divider, a delta chip in words and a footer
 * link. The whole card is one link to the list behind the figure.
 */
export function StatCard({
  href,
  label,
  value,
  unit,
  hero = false,
  spark,
  sparkLabel,
  delta,
  footer,
  tone,
  note,
}: {
  href: string;
  label: string;
  value: number;
  unit: string;
  hero?: boolean;
  spark?: readonly number[];
  sparkLabel?: string;
  delta: ReactNode;
  footer: string;
  tone?: 'warning' | 'danger';
  note?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`card card-link stat${hero ? ' card-hero stat-hero' : ''}${tone ? ` edge-${tone}` : ''}`}
      >
        <Eyebrow tone={hero ? 'hero' : tone}>{label}</Eyebrow>
        <span className="stat-figure">
          <span className="figure">{n(value)}</span>
          <span className="figure-unit">{unit}</span>
        </span>
        {note ? <p className="stat-note">{note}</p> : null}
        {spark && sparkLabel ? <Sparkline values={spark} label={sparkLabel} /> : null}
        <span className="card-foot">
          {delta}
          <span>
            {footer} <ArrowRight size={14} className="icon" aria-hidden="true" />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Initials for a person, as in "Sam Hart" to "SH". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase();
}

/** A person as initials in a 24 px circle followed by the name. */
export function Person({ name }: { name: string | null }) {
  if (!name) return <span className="muted">—</span>;
  return (
    <span className="person">
      <span className="avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span>{name}</span>
    </span>
  );
}

/** The row menu: a visible button for keyboard users, so no action hides behind a hover. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="kebab">
      <summary aria-label={label}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="1.75" fill="currentColor" />
          <circle cx="12" cy="12" r="1.75" fill="currentColor" />
          <circle cx="12" cy="19" r="1.75" fill="currentColor" />
        </svg>
      </summary>
      <div className="kebab-menu">{children}</div>
    </details>
  );
}
