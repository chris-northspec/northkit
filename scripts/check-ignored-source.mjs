// Fails if any file under apps/*/src or packages/*/src is git-ignored. A bare pattern
// in .gitignore (for example "build/") matches at any depth, and once hid a page in
// apps/web/src. Run in CI: node scripts/check-ignored-source.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else out.push(path.replaceAll('\\', '/'));
  }
  return out;
}

const roots = [];
for (const group of ['apps', 'packages']) {
  for (const name of readdirSync(group)) {
    const src = join(group, name, 'src');
    try {
      if (statSync(src).isDirectory()) roots.push(src);
    } catch {
      // No src folder in this workspace package.
    }
  }
}

const all = roots.flatMap(files);
let ignored = '';
try {
  // Exit code 1 means "none ignored"; anything matched is printed one per line.
  ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
    input: all.join('\n'),
    encoding: 'utf8',
  });
} catch (error) {
  if (error.status !== 1) throw error;
}

const hits = ignored.split('\n').filter(Boolean);
if (hits.length > 0) {
  const list = hits.map((h) => `  ${h}`).join('\n');
  process.stderr.write(
    `These source files are git-ignored. Anchor the .gitignore pattern that matches them:\n${list}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `No ignored files under ${roots.length} src folders (${all.length} files checked).\n`,
);
