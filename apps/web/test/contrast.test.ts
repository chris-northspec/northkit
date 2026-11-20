import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The token contrast checks (WCAG 2.2 AA), run in CI so a change of accent can't ship a
// pair that fails. It reads src/styles/tokens.css, resolves var() and color-mix(), and
// checks the accent pairs and every status pair in light and dark. Hi-Vis Yellow is a
// LIGHT accent, so the pairs that matter are Ink on yellow, Tag Brass as text, and yellow
// itself against the dark page. The studio's own script (northspec-standards
// scripts/contrast-check.js) checks the same file and is run by hand.

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const lightBlock = /^:root\s*\{([\s\S]*?)\n\}/m.exec(css)![1]!;
const darkBlock = /prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([\s\S]*?)\}/.exec(css)![1]!;
const light = declarations(lightBlock);
const dark = { ...light, ...declarations(darkBlock) };

type Rgb = [number, number, number];

function colour(value: string, vars: Record<string, string>, depth = 0): Rgb {
  if (depth > 20) throw new Error(`var loop: ${value}`);
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return colour(vars[ref[1]!]!, vars, depth + 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  if (v === 'black') return [0, 0, 0];
  if (v === 'white') return [255, 255, 255];
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = colour(mix[1]!, vars, depth + 1);
    const b = colour(mix[3]!, vars, depth + 1);
    const p = Number(mix[2]) / 100;
    return a.map((x, i) => Math.round(x * p + b[i]! * (1 - p))) as Rgb;
  }
  throw new Error(`can't read colour: ${value}`);
}

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function ratio(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const check = (theme: Record<string, string>, fg: string, bg: string) =>
  ratio(colour(fg, theme), colour(bg, theme));

describe('accent pairs (light)', () => {
  it('puts Ink, never white, on the Hi-Vis Yellow fill', () => {
    expect(light['--colour-on-accent']).toBe('#1b1f24');
    expect(check(light, 'var(--colour-on-accent)', 'var(--accent)')).toBeGreaterThanOrEqual(9.5);
    expect(check(light, 'var(--colour-on-accent)', 'var(--accent-hover)')).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('uses Tag Brass for the accent as text, on Paper, white and Tag Cream', () => {
    for (const bg of ['var(--colour-bg)', 'var(--colour-card)', 'var(--accent-weak)'])
      expect(check(light, 'var(--accent-text)', bg), bg).toBeGreaterThanOrEqual(4.5);
  });

  it('does not use the yellow itself as text on a light surface', () => {
    // It would fail: this documents why --accent-text exists.
    expect(check(light, 'var(--accent)', 'var(--colour-card)')).toBeLessThan(3);
  });

  it('keeps the active-nav bar visible on the Ink sidebar', () => {
    expect(check(light, 'var(--accent-on-dark)', 'var(--sidebar-active)')).toBeGreaterThanOrEqual(
      3,
    );
    expect(check(light, 'var(--accent-on-dark)', 'var(--sidebar-bg)')).toBeGreaterThanOrEqual(3);
  });
});

describe('accent pairs (dark)', () => {
  it('keeps yellow readable as text on the Deep Navy page, cards and tints', () => {
    for (const bg of ['var(--colour-bg)', 'var(--colour-card)', 'var(--accent-weak)'])
      expect(check(dark, 'var(--accent-text)', bg), bg).toBeGreaterThanOrEqual(4.5);
  });

  it('still puts Ink on the yellow fill', () => {
    expect(check(dark, 'var(--colour-on-accent)', 'var(--accent)')).toBeGreaterThanOrEqual(9.5);
  });
});

describe('text and statuses', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`meets AA for text on the page, cards and surfaces in ${name}`, () => {
      for (const bg of ['var(--colour-bg)', 'var(--colour-card)', 'var(--colour-surface)']) {
        expect(check(theme, 'var(--colour-text)', bg), `text on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(
          check(theme, 'var(--colour-text-muted)', bg),
          `muted on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`meets AA for every status pill in ${name}`, () => {
      const pairs = Object.keys(theme)
        .filter((k) => /^--status-.+-text$/.test(k))
        .map((k) => [k, k.replace(/-text$/, '-bg')] as const);
      expect(pairs.length).toBeGreaterThanOrEqual(6);
      for (const [fg, bg] of pairs)
        expect(check(theme, `var(${fg})`, `var(${bg})`), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
          4.5,
        );
    });

    it(`meets AA for the success, warning, danger and info messages in ${name}`, () => {
      for (const m of ['--colour-success', '--colour-warning', '--colour-danger', '--colour-info'])
        expect(check(theme, `var(${m})`, 'var(--colour-card)'), m).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// House style v2 (standard 13): every new surface, neutral, accent-ramp and chart pair, in
// light and dark. A colour that is only decorative (a tick beside its label) isn't listed.
describe('v2 tokens', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`keeps text and muted text readable on every surface level in ${name}`, () => {
      for (const bg of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) {
        expect(
          check(theme, 'var(--colour-text)', `var(${bg})`),
          `text on ${bg}`,
        ).toBeGreaterThanOrEqual(7);
        expect(
          check(theme, 'var(--colour-text-muted)', `var(${bg})`),
          `muted on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`reads the eyebrow, table heads and neutral chips in ${name}`, () => {
      for (const bg of ['--surface-0', '--surface-1', '--surface-2'])
        expect(
          check(theme, 'var(--neutral-600)', `var(${bg})`),
          `eyebrow on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      for (const fg of ['--neutral-700', '--neutral-800', '--neutral-900'])
        expect(
          check(theme, `var(${fg})`, 'var(--neutral-200)'),
          `${fg} on neutral-200`,
        ).toBeGreaterThanOrEqual(4.5);
    });

    it(`reads the accent ramp's text and icons in ${name}`, () => {
      // Icon chips: accent-700 on accent-50; the accent as text on its tints.
      expect(check(theme, 'var(--accent-700)', 'var(--accent-50)')).toBeGreaterThanOrEqual(4.5);
      expect(check(theme, 'var(--accent-700)', 'var(--surface-1)')).toBeGreaterThanOrEqual(3);
      for (const tint of ['--accent-50', '--accent-100']) {
        expect(
          check(theme, 'var(--accent-text)', `var(${tint})`),
          `accent text on ${tint}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          check(theme, 'var(--colour-text)', `var(${tint})`),
          `text on ${tint}`,
        ).toBeGreaterThanOrEqual(7);
      }
      // The hero figure is the accent as text on a card.
      expect(check(theme, 'var(--accent-text)', 'var(--surface-1)')).toBeGreaterThanOrEqual(4.5);
    });

    it(`puts the on-accent colour on the accent fill, its hover and the scanner header in ${name}`, () => {
      for (const fill of ['--accent', '--accent-500', '--accent-600'])
        expect(
          check(theme, 'var(--colour-on-accent)', `var(${fill})`),
          fill,
        ).toBeGreaterThanOrEqual(7);
    });

    it(`keeps charts, sparklines, borders and the focus ring visible in ${name}`, () => {
      for (const bg of ['--surface-0', '--surface-1']) {
        for (const fg of ['--neutral-500', '--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5'])
          expect(check(theme, `var(${fg})`, `var(${bg})`), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
            3,
          );
        expect(
          check(theme, 'var(--colour-focus)', `var(${bg})`),
          `focus on ${bg}`,
        ).toBeGreaterThanOrEqual(3);
        expect(
          check(theme, 'var(--colour-border-strong)', `var(${bg})`),
          `input border on ${bg}`,
        ).toBeGreaterThanOrEqual(3);
      }
      // Severity edges beside their words.
      for (const edge of ['--colour-warning', '--colour-danger'])
        expect(check(theme, `var(${edge})`, 'var(--surface-1)'), edge).toBeGreaterThanOrEqual(3);
    });

    it(`keeps the active nav item readable on the sidebar in ${name}`, () => {
      const tint = 'color-mix(in srgb, var(--accent) 16%, var(--sidebar-bg))';
      expect(check(theme, 'var(--sidebar-text)', tint)).toBeGreaterThanOrEqual(4.5);
      expect(check(theme, 'var(--accent-on-dark)', tint)).toBeGreaterThanOrEqual(3);
    });
  }

  it('makes every ramp step from the one accent line, with nothing hard-coded to a product', () => {
    for (const step of ['50', '100', '200', '300', '700'])
      expect(light[`--accent-${step}`], step).toMatch(/color-mix\(in srgb, var\(--accent\)/);
    expect(light['--accent-500']).toBe('var(--accent)');
  });
});
