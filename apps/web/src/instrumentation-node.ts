import { demoRefusal, demoWarning } from '@northkit/core/demo';

// The demo link (docs/demo-link.md) works under the development server only: any other
// server refuses to start while NORTHKIT_DEMO_ORIGIN is set, and the development server
// says which addresses it trusts to name the visitor. The Docker image refuses earlier
// still, in server/peer-address.mjs.

const refusal = demoRefusal();
if (refusal) {
  process.stderr.write(`${refusal}\n`);
  process.exit(1);
}
const warning = demoWarning();
if (warning) process.stderr.write(`Warning: ${warning}\n`);
