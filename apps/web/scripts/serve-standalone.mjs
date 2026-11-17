// Starts the production build the way the Docker image runs it: the standalone
// server, with the static files and public/ copied beside it (Next leaves those to
// the deployer). Used by Playwright. Run `pnpm --filter @wms/web build` first.
//   node scripts/serve-standalone.mjs [port]
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const web = path.join(import.meta.dirname, '..');
const standalone = path.join(web, '.next', 'standalone', 'apps', 'web');
const server = path.join(standalone, 'server.js');
if (!existsSync(server)) {
  process.stderr.write('No standalone build found. Run `pnpm --filter @wms/web build` first.\n');
  process.exit(1);
}
// A second server on the same build passes --no-copy so two never copy at once.
if (!process.argv.includes('--no-copy')) {
  cpSync(path.join(web, '.next', 'static'), path.join(standalone, '.next', 'static'), {
    recursive: true,
  });
  cpSync(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true });
}

const port = process.argv[2] ?? process.env.PORT ?? '3000';
// The same preload the Docker image uses: the real connecting address for rate limits (D15).
const peer = pathToFileURL(path.join(web, 'server', 'peer-address.mjs')).href;
const child = spawn(process.execPath, ['--import', peer, server], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port, HOSTNAME: process.env.HOSTNAME_BIND ?? 'localhost' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
