import type { ReactNode } from 'react';

// NorthKit's pictures (house style, as NorthSlot and ClearRate): original SVG, no scripts,
// no external links, no embedded fonts. They are drawn inline and coloured only with the
// design tokens (ink, paper, navy, slate, the card and border colours and the accent), so
// light and dark come from the tokens (dark mode swaps them) and a new accent drops
// straight in with no file to redraw. Motif, tied to the tagline "Know where it is. Know
// it's safe.": a tagged item with a thread to its place, and a tick when it is in order.
// Decorative unless given a label: the words beside a picture always say the same thing.

export type IllustrationName = 'auth-hero' | 'empty-items' | 'no-results' | 'all-clear' | 'error';

const INK = 'var(--colour-text)';
const MUTED = 'var(--colour-text-muted)';
const CARD = 'var(--colour-card)';
const EDGE = 'var(--colour-border-strong)';
const ACCENT = 'var(--accent)';
const WASH = 'var(--accent-weak)';
const ON_ACCENT = 'var(--colour-on-accent)';
const PAGE = 'var(--colour-surface)';

/** A kit card with a QR-like tag, as the register shows an item. */
function Tag({ x, y, dim = false }: { x: number; y: number; dim?: boolean }) {
  return (
    <g opacity={dim ? 0.55 : 1}>
      <rect x={x} y={y} width="96" height="72" rx="10" fill={CARD} stroke={EDGE} strokeWidth="2" />
      <rect x={x + 16} y={y + 16} width="28" height="28" rx="3" fill={INK} />
      <path
        d={`M${x + 22} ${y + 22}h6v6h-6zM${x + 32} ${y + 22}h6v6h-6zM${x + 22} ${y + 32}h6v6h-6zM${x + 34} ${y + 34}h4v4h-4z`}
        fill={CARD}
      />
      <path
        d={`M${x + 54} ${y + 22}h28M${x + 54} ${y + 32}h20M${x + 54} ${y + 42}h24`}
        stroke={MUTED}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d={`M${x + 16} ${y + 56}h64`} stroke={EDGE} strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

function Tick({ cx, cy, r = 22 }: { cx: number; cy: number; r?: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={ACCENT} />
      <path
        d={`M${cx - r / 2} ${cy}l${r / 3} ${r / 3}l${r * 0.65} ${-r * 0.7}`}
        stroke={ON_ACCENT}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </>
  );
}

const PICTURES: Record<IllustrationName, { title: string; body: ReactNode }> = {
  'auth-hero': {
    title: 'Three tagged items on a shelf, each with a thread to its place',
    body: (
      <>
        <path
          d="M40 112h400M40 208h400"
          stroke={EDGE}
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".5"
        />
        <Tag x={64} y={40} />
        <Tag x={192} y={136} />
        <Tag x={320} y={40} />
        <g stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M112 112c0 40 20 48 80 48M368 112c0 40-20 48-80 48M240 208v40" />
        </g>
        <circle cx="112" cy="112" r="5" fill={ACCENT} />
        <circle cx="368" cy="112" r="5" fill={ACCENT} />
        <Tick cx={240} cy={262} />
      </>
    ),
  },
  'empty-items': {
    title: 'An empty shelf waiting for its first tagged item',
    body: (
      <>
        <path d="M60 220h360" stroke={EDGE} strokeWidth="4" strokeLinecap="round" />
        <path d="M80 220v40M400 220v40" stroke={EDGE} strokeWidth="4" strokeLinecap="round" />
        <rect
          x="192"
          y="96"
          width="96"
          height="72"
          rx="10"
          fill={WASH}
          stroke={ACCENT}
          strokeWidth="2.5"
          strokeDasharray="8 7"
        />
        <path d="M240 118v28M226 132h28" stroke={ACCENT} strokeWidth="4" strokeLinecap="round" />
        <Tag x={64} y={148} dim />
        <Tag x={320} y={148} dim />
        <path d="M112 220v-0M368 220v-0" stroke={EDGE} />
      </>
    ),
  },
  'no-results': {
    title: 'A magnifying glass over an empty shelf: nothing matches',
    body: (
      <>
        <path d="M60 232h360" stroke={EDGE} strokeWidth="4" strokeLinecap="round" />
        <Tag x={64} y={160} dim />
        <Tag x={320} y={160} dim />
        <circle cx="228" cy="120" r="52" fill={CARD} stroke={ACCENT} strokeWidth="6" />
        <path d="M266 160l44 44" stroke={ACCENT} strokeWidth="10" strokeLinecap="round" />
        <path d="M206 120h44" stroke={MUTED} strokeWidth="5" strokeLinecap="round" />
      </>
    ),
  },
  'all-clear': {
    title: 'Every item in its place, each with a tick: nothing needs action',
    body: (
      <>
        <path
          d="M40 130h400M40 230h400"
          stroke={EDGE}
          strokeWidth="2"
          strokeLinecap="round"
          opacity=".5"
        />
        <Tag x={64} y={58} />
        <Tag x={192} y={58} />
        <Tag x={320} y={58} />
        <Tick cx={112} cy={150} r={16} />
        <Tick cx={240} cy={150} r={16} />
        <Tick cx={368} cy={150} r={16} />
        <rect
          x="150"
          y="186"
          width="180"
          height="44"
          rx="22"
          fill={WASH}
          stroke={ACCENT}
          strokeWidth="2"
        />
        <path d="M184 208h112" stroke={ACCENT} strokeWidth="4" strokeLinecap="round" />
      </>
    ),
  },
  error: {
    title: 'A tag that has come away from its item',
    body: (
      <>
        <path d="M60 232h360" stroke={EDGE} strokeWidth="4" strokeLinecap="round" />
        <g transform="rotate(-9 240 120)">
          <Tag x={192} y={84} />
        </g>
        <path
          d="M240 190c0 24 -18 20 -18 40"
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="2 9"
          fill="none"
        />
        <circle cx="222" cy="244" r="6" fill={ACCENT} />
        <path
          d="M100 70l16 16M116 70l-16 16M364 54l12 12M376 54l-12 12"
          stroke={MUTED}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect
          x="64"
          y="148"
          width="72"
          height="56"
          rx="8"
          fill={PAGE}
          stroke={EDGE}
          strokeWidth="2"
        />
      </>
    ),
  },
};

export function Illustration({
  name,
  className,
  label,
  width = 480,
  height = 320,
}: {
  name: IllustrationName;
  className?: string;
  /** Leave out for a decorative picture (the usual case). */
  label?: string;
  width?: number;
  height?: number;
}) {
  const p = PICTURES[name];
  return (
    <svg
      className={className ?? 'illustration'}
      viewBox="0 0 480 320"
      width={width}
      height={height}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      fill="none"
    >
      <title>{p.title}</title>
      <rect width="480" height="320" rx="24" fill={PAGE} />
      {p.body}
    </svg>
  );
}
