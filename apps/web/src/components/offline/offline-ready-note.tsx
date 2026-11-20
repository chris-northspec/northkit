'use client';

import { useOfflineReady } from '@/lib/offline/ready';

/**
 * Keeps this page on the phone for use with no signal (the service worker's offline copy)
 * and says so once it is kept.
 */
export function OfflineReadyNote({ path }: { path: string }) {
  const state = useOfflineReady(path);
  if (state !== 'ready') return null;
  return (
    <p className="muted small offline-ready" role="status">
      Works offline on this phone: what you do with no signal is kept and sent when there’s one.
    </p>
  );
}
