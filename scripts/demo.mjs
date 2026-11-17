// `pnpm demo` and `pnpm demo:docker` (docs/demo-link.md): the demo link on NorthSpec's own
// demo PC, and nothing else. They load deploy/.env.demo (git-ignored; copy
// deploy/.env.demo.example), which holds the demo's settings so the install's deploy/.env
// never needs them.
//
//   pnpm demo           the development server on port 3030 against the demo database,
//                       after checking the shared demo Administrator (left alone when its
//                       password already matches, so starting the demo signs nobody out).
//   pnpm demo:docker    the Docker demo profile: its own database, the app and a small
//                       proxy in the same network namespace (the only thing the app trusts
//                       to name the visitor), published on 127.0.0.1 only. Seeds the
//                       fictional company the first time. `--reset` seeds it again.
//
// Values in deploy/.env.demo win over deploy/.env for these commands only. Never prints a
// password.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const demoFile = path.join(root, 'deploy', '.env.demo');
const installFile = path.join(root, 'deploy', '.env');
const compose = path.join(root, 'deploy', 'docker-compose.yml');
const docker = process.argv.includes('--docker');
const reset = process.argv.includes('--reset');
const DEMO_DB = /^northkit_[a-z0-9_]*(demo|dev)[a-z0-9_]*$/;

function stop(message) {
  process.stderr.write(`pnpm demo: ${message}\n`);
  process.exit(1);
}

if (!existsSync(demoFile))
  stop(
    'deploy/.env.demo not found. Copy deploy/.env.demo.example to deploy/.env.demo and fill it in (docs/demo-link.md).',
  );

// deploy/.env.demo wins for this command: read it ourselves, then set every value.
const demo = {};
for (const line of readFileSync(demoFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !line.trimStart().startsWith('#')) demo[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const required = ['NORTHKIT_DEMO_ORIGIN', 'NORTHKIT_DB_NAME', 'DEMO_SHARED_PASSWORD'];
if (docker)
  required.push(
    'DEMO_POSTGRES_PASSWORD',
    'DEMO_APP_DB_PASSWORD',
    'DEMO_SECRET_KEY',
    'SEED_DEMO_PASSWORD',
  );
for (const name of required)
  if (!demo[name]) stop(`set ${name} in deploy/.env.demo (see deploy/.env.demo.example).`);
if (!DEMO_DB.test(demo.NORTHKIT_DB_NAME))
  stop(
    `NORTHKIT_DB_NAME in deploy/.env.demo is "${demo.NORTHKIT_DB_NAME}": the demo only runs on a demo or development database (a name like northkit_demo_test).`,
  );
try {
  new URL(demo.NORTHKIT_DEMO_ORIGIN);
} catch {
  stop(
    'NORTHKIT_DEMO_ORIGIN in deploy/.env.demo is not an address (e.g. https://northkit-demo.example).',
  );
}

// The install's file must not carry the demo line (the Docker install refuses to start
// with it). Say so rather than quietly using it.
if (
  existsSync(installFile) &&
  /^NORTHKIT_DEMO_ORIGIN=\s*\S/m.test(readFileSync(installFile, 'utf8'))
)
  process.stderr.write(
    'pnpm demo: deploy/.env still sets NORTHKIT_DEMO_ORIGIN. Remove that line: the demo reads it from deploy/.env.demo, and the Docker install refuses to start while deploy/.env has it.\n',
  );

const PORT = Number(demo.NORTHKIT_DEMO_PORT || 3030);
const free = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(PORT);
});
if (!free)
  stop(
    `port ${PORT} is in use. If it's the normal Docker install, stop its web and worker first: docker compose -f deploy/docker-compose.yml stop web worker`,
  );

const shell = process.platform === 'win32';
const run = (cmd, args, env) => spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', shell });

if (docker) {
  const env = { ...process.env, ...demo, BUILDX_BAKE_ENTITLEMENTS_FS: '0' };
  const base = [
    'compose',
    '-f',
    compose,
    '--profile',
    'demo',
    // deploy/.env for the values both installs share, deploy/.env.demo on top.
    ...(existsSync(installFile) ? ['--env-file', installFile] : []),
    '--env-file',
    demoFile,
  ];
  if (run('docker', [...base, 'up', '-d', '--wait', 'db-demo'], env).status !== 0)
    stop('the demo database did not start (above).');
  const have = spawnSync(
    'docker',
    [
      ...base,
      'exec',
      '-T',
      'db-demo',
      'psql',
      '-U',
      'postgres',
      '-d',
      demo.NORTHKIT_DB_NAME,
      '-tAc',
      'SELECT count(*) FROM register.items',
    ],
    { cwd: root, env, encoding: 'utf8', shell },
  );
  const seeded = have.status === 0 && Number(have.stdout.trim()) > 0;
  if (reset || !seeded) {
    process.stdout.write('pnpm demo: seeding the fictional demo company\n');
    if (run('docker', [...base, 'run', '--rm', '--build', 'demo-seed'], env).status !== 0)
      stop('seeding the demo company failed (above).');
  }
  if (
    run(
      'docker',
      [...base, 'up', '-d', '--build', '--wait', 'web-demo', 'demo-proxy', 'worker-demo'],
      env,
    ).status !== 0
  )
    stop('the demo did not start (above).');
  process.stdout.write(
    `pnpm demo: running on http://127.0.0.1:${PORT} (and ${demo.NORTHKIT_DEMO_ORIGIN} through your tunnel). Stop it with: docker compose -f deploy/docker-compose.yml --profile demo stop web-demo demo-proxy worker-demo db-demo\n`,
  );
  process.exit(0);
}

const env = { ...process.env, ...demo };
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
if (run(pnpm, ['--filter', '@northkit/core', 'demo-user', '--check'], env).status !== 0)
  stop('the demo user check failed (above).');

const dev = spawn(
  process.execPath,
  [path.join(root, 'apps', 'web', 'scripts', 'dev.mjs'), '--port', String(PORT)],
  { cwd: path.join(root, 'apps', 'web'), env, stdio: 'inherit' },
);
dev.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
