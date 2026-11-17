import { optionalEnv } from '@northkit/db';

// The demo link (docs/demo-link.md): the address Chris shows the product on through a
// Cloudflare Tunnel from his own PC, with fictional data only. Set by
// NORTHKIT_DEMO_ORIGIN; blank (the default) means none, and nothing here changes.
//
// With it set, the app believes Cf-Connecting-Ip and X-Forwarded-For from this machine
// (loopback), where the tunnel connects from. That is only safe on the demo PC, so it
// works under the development server (`pnpm dev`) only: the production build and the
// Docker image refuse to start with it set (demoRefusal, src/instrumentation.ts and
// server/peer-address.mjs), and the development server warns at start-up (demoWarning).

/** The addresses trusted to name the visitor while the demo link is on. */
export const DEMO_TRUSTED_ADDRESSES = ['127.0.0.1', '::1'] as const;

export interface DemoOrigin {
  /** e.g. https://northkit-demo.example */
  origin: string;
  /** e.g. northkit-demo.example (with a port if it has one) */
  host: string;
}

function parse(value: string | undefined): DemoOrigin | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { origin: url.origin, host: url.host };
  } catch {
    return null;
  }
}

/** The demo address, or null when it isn't set, or when this is a production server. */
export function demoOrigin(): DemoOrigin | null {
  if (process.env.NODE_ENV === 'production') return null;
  return parse(optionalEnv('NORTHKIT_DEMO_ORIGIN'));
}

/** True when a request's Host header is the demo address. */
export function isDemoHost(host: string | null | undefined): boolean {
  const demo = demoOrigin();
  return demo !== null && !!host && host.toLowerCase() === demo.host.toLowerCase();
}

/**
 * Why this server must not start, or null. Any server that isn't the development one
 * (NODE_ENV other than "development": next start, the standalone build, the Docker
 * image) refuses while NORTHKIT_DEMO_ORIGIN is set, so a customer install can never
 * trust forwarded headers from loopback by accident.
 */
export function demoRefusal(
  value: string | undefined = optionalEnv('NORTHKIT_DEMO_ORIGIN'),
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  if (!value || nodeEnv === 'development') return null;
  return (
    'NorthKit will not start: NORTHKIT_DEMO_ORIGIN is set, and the demo link only works ' +
    'under the development server (`pnpm dev`, docs/demo-link.md). It makes the app trust ' +
    'forwarded headers from this machine, which a production install must not do. Remove ' +
    'NORTHKIT_DEMO_ORIGIN from deploy/.env and the environment, then start it again.'
  );
}

/** The start-up warning for the development server while the demo link is on, or null. */
export function demoWarning(
  value: string | undefined = optionalEnv('NORTHKIT_DEMO_ORIGIN'),
): string | null {
  const demo = parse(value);
  if (!demo) return null;
  return (
    `Demo link on (${demo.origin}): trusting Cf-Connecting-Ip and X-Forwarded-For from ` +
    `${DEMO_TRUSTED_ADDRESSES.join(' and ')} (this machine) to name the visitor. ` +
    'Fictional data only (docs/demo-link.md).'
  );
}
