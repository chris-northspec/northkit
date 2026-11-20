'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { onQueueChange, unsyncedCount } from '@/lib/offline/store';
import { ensureControlled } from '@/lib/offline/ready';
import { flush, onSent, retryDelay, type SentNote } from '@/lib/offline/sync';

/**
 * On every signed-in page: registers the service worker, replays the offline queue when
 * there is a connection (on load, when the phone comes back online, when the app comes back
 * to the front, and with back-off while anything waits), and shows what hasn't synced: a
 * banner with a count (S3-6). A change the server refused is kept and shown, with a link to
 * see why.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const [counts, setCounts] = useState({ waiting: 0, refused: 0 });
  const [online, setOnline] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);
  const [sent, setSent] = useState<SentNote[]>([]);
  const before = useRef(0);

  useEffect(
    () =>
      onSent((note) => {
        setSent((now) => [...now, note].slice(-3));
      }),
    [],
  );

  useEffect(() => {
    // `in`, not `!navigator.serviceWorker`: a page served without a service worker (plain
    // http other than localhost, some private windows) must not crash.
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => ensureControlled())
      .catch(() => {
        // No service worker: pages still work online.
      });
  }, []);

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const refresh = async () => {
      const next = await unsyncedCount(userId).catch(() => ({ waiting: 0, refused: 0 }));
      if (stopped) return;
      if (before.current > 0 && next.waiting === 0) setJustSynced(true);
      if (next.waiting > 0) setJustSynced(false);
      before.current = next.waiting;
      setCounts(next);
    };
    const run = async () => {
      clearTimeout(timer);
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        const result = await flush(userId).catch(() => ({
          sent: 0,
          waiting: true,
          lastError: null,
        }));
        if (stopped) return;
        setLastError(result.lastError);
        if (result.waiting) timer = setTimeout(() => void run(), retryDelay(attempt++));
        else attempt = 0;
      }
      await refresh();
    };
    const soon = () => {
      clearTimeout(timer);
      void refresh();
      timer = setTimeout(() => void run(), 300);
    };
    const offline = () => setOnline(false);
    const visible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    void run();
    const unsubscribe = onQueueChange(soon);
    window.addEventListener('online', soon);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('online', soon);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId]);

  let message: React.ReactNode = null;
  if (counts.waiting > 0 || counts.refused > 0) {
    message = (
      <>
        {counts.waiting > 0 ? (
          <>
            <strong data-testid="waiting-count">
              {counts.waiting} change{counts.waiting === 1 ? '' : 's'} not synced.
            </strong>{' '}
            {counts.waiting === 1 ? 'It is' : 'They are'} saved on this phone and will send{' '}
            {online ? 'shortly' : 'when there is a connection'}.
            {lastError && online ? ` Last try: ${lastError}` : ''}
          </>
        ) : null}
        {counts.refused > 0 ? (
          <>
            {' '}
            <strong>
              {counts.refused} change{counts.refused === 1 ? '' : 's'} couldn’t be applied.
            </strong>{' '}
            {counts.refused === 1 ? 'It is' : 'They are'} kept on this phone:{' '}
            <Link href="/sync">see why</Link>.
          </>
        ) : null}
      </>
    );
  } else if (!online) {
    message =
      'You’re offline. Check-out, check-in, missing reports and stocktake scans keep working, and changes are saved on this phone.';
  } else if (justSynced) {
    message = 'All changes synced.';
  }

  return (
    <div className="sync-status" role="status" aria-live="polite">
      {message ? (
        <p
          className={`notice ${counts.refused ? 'notice-critical' : counts.waiting || !online ? 'notice-warning' : 'notice-info'}`}
        >
          {message}
          {counts.waiting > 0 && counts.refused === 0 ? (
            <>
              {' '}
              <Link href="/sync">What’s waiting</Link>
            </>
          ) : null}
        </p>
      ) : null}
      {sent.length && !counts.waiting && !counts.refused ? (
        <p className="visually-hidden">{sent.at(-1)!.message}</p>
      ) : null}
    </div>
  );
}
