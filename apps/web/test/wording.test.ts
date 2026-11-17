import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A19 (ADR 0003): NorthKit records inspections and certificates; it never performs,
// certifies or signs off a statutory examination. No screen, email, report or label may say
// NorthKit certifies, approves or makes anything compliant. This scans the app's own text
// (the web app's source and the core services' messages) for words that would say so, and
// allows them only on a line that says NorthKit does NOT (the notice itself).

const ROOTS = [
  path.join(import.meta.dirname, '..', 'src'),
  path.join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src'),
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const CLAIMS = [
  /\bcertif(?:y|ies|ied|ication)\b/i,
  /\bmakes? (?:you|it|your \w+) compliant\b/i,
  /\bapproved by northkit\b/i,
  /\bnorthkit (?:approves|passes|signs off|guarantees|ensures compliance)\b/i,
  /\bguarantee[sd]? compliance\b/i,
  /\blegal record\b/i,
  /\bstatutory report\b/i,
];

/** A line that denies the claim ("never certifies", "does not certify", "not legal advice"). */
const DENIAL = /\b(?:never|not|n[o’']t|doesn[’']t|can[’']t|won[’']t|no)\b/i;

describe('wording (A19)', () => {
  const all = ROOTS.flatMap(files).map((f) => ({
    rel: f.replaceAll('\\', '/').replace(/^.*\/(apps|packages)\//, '$1/'),
    lines: readFileSync(f, 'utf8').split('\n'),
  }));

  it('scans the app’s text', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('never says NorthKit certifies, approves or makes anything compliant', () => {
    const found = all.flatMap((f) =>
      f.lines.flatMap((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
        const claim = CLAIMS.find((c) => c.test(line));
        return claim && !DENIAL.test(line)
          ? [`${f.rel}:${i + 1}: ${line.trim().slice(0, 100)}`]
          : [];
      }),
    );
    expect(found).toEqual([]);
  });

  it('states the boundary wherever the kinds’ rules are shown', () => {
    const kinds = all
      .find((f) => f.rel === 'packages/core/src/services/kinds.ts')!
      .lines.join('\n');
    expect(kinds).toMatch(/not legal advice/);
    expect(kinds).toMatch(/never performs or certifies an examination/);
  });
});
