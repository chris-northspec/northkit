// Licence gate (CLAUDE.md, build plan section 7). Fails if any installed package's
// licence is outside the allow-list, unless the licence is on the conditional list and
// its condition is met, or the package is in scripts/licence-exceptions.json with a
// matching licence and scope. SPDX "A OR B" passes if either side is allowed;
// "A AND B" needs both.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  // MIT without the attribution condition; OSI-approved, fine for closed-source sale (D14).
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'PostgreSQL',
  '0BSD',
  // Permissive, no copyleft, fine in closed-source products (Chris, 15 Nov 2026, D64).
  'Zlib',
]);

// Approved by Chris on 13 Nov 2026, with conditions. Reasons are recorded in
// docs/dependencies.md and credits in LICENCES/CREDITS.md.
const CONDITIONAL = {
  // Data only, with credit: each package must be credited in LICENCES/CREDITS.md.
  'CC-BY-4.0': { developmentOnly: false, needsCredit: true, unmodified: false },
  // Build tools only: never shipped in the running product.
  'BlueOak-1.0.0': { developmentOnly: true, needsCredit: false, unmodified: false },
  // Build tools only, not modified: never shipped, and never patched.
  'MPL-2.0': { developmentOnly: true, needsCredit: false, unmodified: true },
  // Approved 14 Nov 2026: font files only, never code, credited and not modified
  // (Inter, self-hosted from @fontsource/inter).
  'OFL-1.1': { developmentOnly: false, needsCredit: true, unmodified: true, fontFilesOnly: true },
};

// What a font package may contain: font files, the stylesheets that declare them,
// empty type stubs, and package metadata. Anything else (JavaScript) is code.
const FONT_PACKAGE_FILE =
  /(\.(woff2?|ttf|otf|eot|css|scss|json|md)|\.d\.ts|\.d\.css\.ts|^LICEN[CS]E(\.\w+)?)$/i;

/** Files in a package that aren't font files (or their stylesheets and metadata). */
function nonFontFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules') continue;
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (!FONT_PACKAGE_FILE.test(entry)) out.push(path.slice(dir.length + 1));
    }
  };
  walk(dir);
  return out;
}
const credits = readFileSync(new URL('../LICENCES/CREDITS.md', import.meta.url), 'utf8');
const patchConfig = ['../package.json', '../pnpm-workspace.yaml']
  .map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

/** Why a conditionally allowed licence is not allowed here, or null if it is. */
function conditionFailure(name, licence, scope, paths = []) {
  const rule = CONDITIONAL[licence];
  if (!rule) return 'licence not allowed';
  if (rule.fontFilesOnly) {
    const code = paths.flatMap(nonFontFiles);
    if (paths.length === 0 || code.length)
      return `${licence} is allowed for font files only, but the package has ${code.slice(0, 3).join(', ') || 'no files to check'}`;
  }
  if (rule.developmentOnly && scope === 'production')
    return `${licence} is allowed for build tools only, not shipped code`;
  if (rule.needsCredit && !credits.includes(`\`${name}\``))
    return `${licence} needs a credit for \`${name}\` in LICENCES/CREDITS.md`;
  if (rule.unmodified && patchConfig.includes(`${name}@`))
    return `${licence} packages must not be patched`;
  return null;
}

const exceptions = JSON.parse(
  readFileSync(new URL('./licence-exceptions.json', import.meta.url), 'utf8'),
);

function allowed(expression) {
  const text = expression.replace(/^\(|\)$/g, '').trim();
  if (/ OR /.test(text)) return text.split(/ OR /).some(allowed);
  if (/ AND /.test(text)) return text.split(/ AND /).every(allowed);
  return ALLOWED.has(text);
}

const paths = new Map();

function list(prodOnly) {
  const args = ['licenses', 'list', '--json', ...(prodOnly ? ['--prod'] : [])];
  // Run under `pnpm licences:check`, which sets npm_execpath to pnpm's own script.
  const pnpm = process.env.npm_execpath;
  const out = pnpm
    ? execFileSync(process.execPath, [pnpm, ...args], { encoding: 'utf8' })
    : execFileSync('pnpm', args, { encoding: 'utf8' });
  const packages = new Map();
  for (const [licence, entries] of Object.entries(JSON.parse(out))) {
    for (const entry of entries) {
      packages.set(entry.name, licence);
      paths.set(entry.name, entry.paths ?? []);
    }
  }
  return packages;
}

const production = list(true);
const all = list(false);
const problems = [];
const used = new Set();
const conditional = new Set();

for (const [name, licence] of all) {
  if (allowed(licence)) continue;
  const scope = production.has(name) ? 'production' : 'development';
  const failure = conditionFailure(name, licence, scope, paths.get(name));
  if (failure === null) {
    conditional.add(name);
    continue;
  }
  const exception = exceptions[name];
  if (
    exception &&
    exception.licence === licence &&
    (exception.scope === scope || exception.scope === 'production')
  ) {
    used.add(name);
    continue;
  }
  problems.push(
    `${name}: ${licence} (${scope}) - ${exception ? 'exception does not match' : failure}`,
  );
}

for (const name of conditional)
  process.stdout.write(`allowed with conditions: ${name} (${all.get(name)})
`);
for (const name of used)
  process.stdout.write(`allowed by exception: ${name} (${exceptions[name].licence})\n`);
if (problems.length) {
  process.stderr.write(`Licences not allowed:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `Licence check passed: ${all.size} packages, ${production.size} in production.\n`,
);
