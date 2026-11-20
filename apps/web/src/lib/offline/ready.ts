'use client';

import { useEffect, useState } from 'react';

// Whether this page can work offline (IN-5, Offline rules). Two things must be true: the
// service worker controls the page, and (on the runner) the page itself is kept in its
// cache. The first is not automatic: a page that loaded while the worker was still
// installing (for example the page opened straight after signing in, while the sign-in
// page's registration was finishing) is missed by the worker's own clients.claim() and
// stays uncontrolled until a full reload. Sprint 7 found this behind the offline test's
// one-in-three time-outs. So the page asks the active worker to claim it, and only says
// "ready" once `controllerchange` has fired and the worker has confirmed the page is kept.

export type OfflineReadiness = 'checking' | 'ready' | 'unsupported';

const CLAIM_TIMEOUT_MS = 15_000;

/** Resolves once the page is controlled by the active service worker. */
export async function ensureControlled(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const sw = navigator.serviceWorker;
  const registration = await sw.ready;
  if (sw.controller) return registration;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sw.removeEventListener('controllerchange', done);
      reject(new Error('The service worker did not take control of this page.'));
    }, CLAIM_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      sw.removeEventListener('controllerchange', done);
      resolve();
    }
    sw.addEventListener('controllerchange', done);
    // The worker is active (ready resolved), so claiming now takes this page.
    registration.active?.postMessage({ type: 'claim' });
    if (sw.controller) done();
  });
  return registration;
}

/** Asks the worker to keep these pages and waits for it to say they are kept. */
export async function keepPages(
  registration: ServiceWorkerRegistration,
  paths: string[],
): Promise<number> {
  const worker = navigator.serviceWorker.controller ?? registration.active;
  if (!worker) return 0;
  return new Promise<number>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(0), CLAIM_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<{ kept?: number }>) => {
      clearTimeout(timer);
      resolve(event.data.kept ?? 0);
    };
    worker.postMessage({ type: 'keep-pages', paths }, [channel.port2]);
  });
}

/**
 * 'ready' once the page is controlled and, if `keepPath` is given, that page is in the
 * worker's offline cache. Retries while it isn't, so nobody has to reload.
 */
export function useOfflineReady(keepPath?: string): OfflineReadiness {
  const [state, setState] = useState<OfflineReadiness>('checking');
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setState('unsupported');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      try {
        const registration = await ensureControlled();
        if (!registration) return setState('unsupported');
        if (keepPath && (await keepPages(registration, [keepPath])) < 1)
          throw new Error('not kept yet');
        if (!stopped) setState('ready');
      } catch {
        // No signal yet, or the worker is still starting: try again shortly.
        if (!stopped) timer = setTimeout(() => void attempt(), 3_000);
      }
    };
    void attempt();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [keepPath]);
  return state;
}
