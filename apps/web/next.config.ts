import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// The demo link (docs/demo-link.md): NORTHKIT_DEMO_ORIGIN, e.g. the Cloudflare Tunnel
// address Chris shows the product on, is accepted as well as the address the app runs on.
// Read from deploy/.env as the app reads its other settings; values already in the
// environment win. Never a hard-coded hostname (hosting-ready rule). Development server
// only: a production build never carries it, and a production server refuses to start
// with it set (src/instrumentation.ts).
const envFile = path.join(import.meta.dirname, '../../deploy/.env');
if (!process.env.NORTHKIT_DEMO_ORIGIN && existsSync(envFile)) {
  const line = /^NORTHKIT_DEMO_ORIGIN=(.*)$/m.exec(readFileSync(envFile, 'utf8'));
  if (line?.[1]?.trim()) process.env.NORTHKIT_DEMO_ORIGIN = line[1].trim();
}
const demoHostFor = (phase: string) => {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return null;
  try {
    return process.env.NORTHKIT_DEMO_ORIGIN ? new URL(process.env.NORTHKIT_DEMO_ORIGIN).host : null;
  } catch {
    return null;
  }
};

const nextConfig = (phase: string): NextConfig => {
  const demoHost = demoHostFor(phase);
  return {
    output: 'standalone',
    outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
    transpilePackages: ['@northkit/core', '@northkit/db', '@northkit/licence'],
    serverExternalPackages: ['pg', '@node-rs/argon2', 'pdfkit', 'webp-wasm'],
    poweredByHeader: false,
    // sharp (LGPL libvips) is excluded from the install, so the optimiser can't run.
    images: { unoptimized: true },
    // Spreadsheet imports (5 MB) and up to ten item photos (10 MB each) post to server actions.
    experimental: {
      serverActions: {
        bodySizeLimit: '110mb',
        // Only matters if a proxy in front rewrites the Host header; the same origin is
        // always allowed.
        ...(demoHost ? { allowedOrigins: [demoHost] } : {}),
      },
    },
    // next dev serves its scripts and hot reload only to origins it knows.
    ...(demoHost ? { allowedDevOrigins: [demoHost.replace(/:\d+$/, '')] } : {}),
    headers() {
      return Promise.resolve([
        {
          source: '/:path*',
          headers: [
            // Next's own inline bootstrap scripts need 'unsafe-inline' without a nonce
            // set-up; everything else is locked to this origin.
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                `script-src 'self' 'unsafe-inline'${phase === PHASE_DEVELOPMENT_SERVER ? " 'unsafe-eval'" : ''}`,
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "connect-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
              ].join('; '),
            },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'same-origin' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=()' },
          ],
        },
      ]);
    },
  };
};

export default nextConfig;
