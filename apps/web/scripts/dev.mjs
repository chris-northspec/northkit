// `pnpm dev`: next dev with the same peer-address preload the production server uses
// (server/peer-address.mjs), so rate limits and the audit trail get the real connecting
// address in development too, and the demo link (docs/demo-link.md) can trust its tunnel
// on this machine. NODE_OPTIONS reaches the server process next dev starts.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const preload = new URL('../server/peer-address.mjs', import.meta.url).href;
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [next, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${preload}`.trim(),
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
