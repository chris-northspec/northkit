import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// S2-0: every colour goes through the design tokens, so a new accent drops straight in and
// nothing assumes white text on the accent (the leading option is a light accent with dark
// text). The only file that may contain a colour literal is styles/tokens.css. Source files
// that can't read CSS variables are listed below with the reason.

const SRC = path.join(import.meta.dirname, '..', 'src');

/** Files that may hold a colour literal, and why. */
const ALLOWED: Record<string, string> = {
  'styles/tokens.css': 'the one place colours are defined',
  'app/layout.tsx':
    'the browser theme-colour tag can’t read CSS variables; it is Ink, not the accent',
  'app/manifest.ts':
    'a web app manifest can’t read CSS variables; mirrors --colour-bg and --accent',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(css|ts|tsx|mjs)$/.test(name) ? [full] : [];
  });
}

// A hex colour: # then 3, 4, 6 or 8 hex digits, not part of a longer word or an anchor
// such as #add-heading.
const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const FUNCTIONAL = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;

describe('colour tokens', () => {
  const all = files(SRC).map((f) => ({
    rel: path.relative(SRC, f).replaceAll('\\', '/'),
    text: readFileSync(f, 'utf8'),
  }));

  it('finds the source files it is meant to check', () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all.some((f) => f.rel === 'styles/tokens.css')).toBe(true);
    expect(all.some((f) => f.rel === 'styles/app.css')).toBe(true);
  });

  it('has no hard-coded hex colour outside tokens.css', () => {
    const found = all
      .filter((f) => !(f.rel in ALLOWED))
      .flatMap((f) => [...f.text.matchAll(HEX)].map((m) => `${f.rel}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it('has no rgb(), hsl() or similar colour function outside tokens.css', () => {
    const found = all
      .filter((f) => !(f.rel in ALLOWED))
      .flatMap((f) => [...f.text.matchAll(FUNCTIONAL)].map((m) => `${f.rel}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it('lists only allowed exceptions that still exist', () => {
    for (const rel of Object.keys(ALLOWED))
      expect(
        all.some((f) => f.rel === rel),
        rel,
      ).toBe(true);
  });

  it('puts text on an accent fill through --colour-on-accent, never a fixed white', () => {
    const css = all.find((f) => f.rel === 'styles/app.css')!.text;
    // Every rule that fills with the accent must also set its text colour from the token.
    const rules = [
      ...css.matchAll(
        /([^{}]+)\{([^{}]*background(?:-color)?:\s*var\(--accent(?:-hover)?\)[^{}]*)\}/g,
      ),
    ];
    expect(rules.length).toBeGreaterThan(0);
    const missing = rules
      .filter(
        ([, , body]) =>
          !/color:\s*var\(--colour-on-accent\)/.test(
            body!.replace(/background(-color)?:[^;]*;/g, ''),
          ),
      )
      .map(([, selector]) => selector!.trim());
    expect(missing).toEqual([]);
    expect(css).not.toMatch(/color:\s*(?:white|#fff)/i);
  });
});
