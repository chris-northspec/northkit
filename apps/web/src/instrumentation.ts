// Runs once when a Next.js server starts (next dev, next start, the standalone build).
// The demo link check is Node-only, so it lives in instrumentation-node.ts.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
