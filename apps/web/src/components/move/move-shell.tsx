'use client';

import { Check, CloudOff, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useOfflineUser } from '@/components/offline/offline-user';
import { useOfflineReady } from '@/lib/offline/ready';
import { loadSnapshot, type OfflineSnapshot } from '@/lib/offline/snapshot';
import type { SubmitResult } from '@/lib/offline/submit';

// The frame every scanner screen shares (standard 13, scanner screens): a coloured step
// header, very large targets, one step per screen, a big confirmation tick and a clear shake
// with words on error. It loads the phone's copy of the register once and hands it to the
// flow, saying plainly when it is working from the copy on the phone.

export function StepHead({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <div className="scan-head">
      <span className="step" aria-hidden="true">
        {step}
      </span>
      <div>
        <h1>
          <span className="visually-hidden">Step {step}: </span>
          {title}
        </h1>
        {hint ? <p>{hint}</p> : null}
      </div>
    </div>
  );
}

export function ScanError({ message }: { message: string | null }) {
  if (!message) return null;
  // A new key per message restarts the shake.
  return (
    <p className="scan-error" role="alert" key={message}>
      <TriangleAlert size={22} className="icon" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

export function Done({
  title,
  result,
  lines,
  again,
  children,
}: {
  title: string;
  result: SubmitResult;
  lines: string[];
  again: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  const allRefused = result.refused.length > 0 && result.saved === result.refused.length;
  return (
    <div className="scan-done">
      {allRefused ? null : (
        <span className="confirm-tick" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <path d="M12 29 L24 41 L44 15" />
          </svg>
        </span>
      )}
      <h1>{allRefused ? 'Not done' : result.waiting ? 'Saved on this phone' : title}</h1>
      {result.waiting ? (
        <p className="notice notice-warning">
          <CloudOff size={18} className="icon" aria-hidden="true" /> No signal, so{' '}
          {result.waiting === 1 ? 'this change is' : `these ${result.waiting} changes are`} kept on
          this phone and will send when there is a connection.{' '}
          <Link href="/sync">What’s waiting</Link>
        </p>
      ) : null}
      {lines.length && !allRefused ? (
        <ul className="plain stack" aria-label="What was done">
          {lines.map((l) => (
            <li key={l}>
              <Check size={16} className="icon" aria-hidden="true" /> {l}
            </li>
          ))}
        </ul>
      ) : null}
      {result.refused.map((r) => (
        <ScanError key={r.label} message={`${r.label}: ${r.error}`} />
      ))}
      {children}
      <div className="scan-actions">
        <button type="button" className="scan-btn scan-btn-primary" onClick={again.onClick}>
          {again.label}
        </button>
        <Link className="scan-btn" href="/">
          Back to the overview
        </Link>
      </div>
    </div>
  );
}

/** Loads the phone's copy of the kit and shows `children(snapshot)`. */
export function MoveShell({
  keepPath,
  children,
}: {
  /** The page to keep for offline use. */
  keepPath: string;
  children: (args: { snapshot: OfflineSnapshot; userId: string }) => ReactNode;
}) {
  const user = useOfflineUser();
  const [loaded, setLoaded] = useState<
    { snapshot: OfflineSnapshot; stale: boolean } | null | undefined
  >(undefined);
  const ready = useOfflineReady(keepPath);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    void loadSnapshot(user.id).then((l) => {
      if (!stopped) setLoaded(l);
    });
    // Come back to the front, or back online: refresh the copy.
    const refresh = () => void loadSnapshot(user.id).then((l) => !stopped && setLoaded(l));
    window.addEventListener('online', refresh);
    return () => {
      stopped = true;
      window.removeEventListener('online', refresh);
    };
  }, [user]);

  if (!user) return null;
  if (loaded === undefined)
    return (
      <div aria-busy="true" className="scan">
        <p className="visually-hidden" role="status">
          Loading the kit…
        </p>
        <span className="skeleton skeleton-card" aria-hidden="true" />
        <span className="skeleton skeleton-row" aria-hidden="true" />
      </div>
    );
  if (loaded === null)
    return (
      <div className="scan">
        <ScanError message="This phone has no copy of the kit yet, and there is no connection to fetch it. Open this screen once with a signal, then it works without one." />
      </div>
    );
  return (
    <div className="scan" data-offline-ready={ready === 'ready' ? 'true' : 'false'}>
      {loaded.stale ? (
        <p className="notice notice-warning">
          Working from the copy of the kit on this phone, made{' '}
          {new Intl.DateTimeFormat('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(loaded.snapshot.generatedAt))}
          . Anything that has changed since is checked when your changes are sent.
        </p>
      ) : null}
      {loaded.snapshot.truncated ? (
        <p className="notice notice-warning">
          This register is bigger than a phone keeps, so some items won’t be found here. Use a
          computer for those.
        </p>
      ) : null}
      {children({ snapshot: loaded.snapshot, userId: user.id })}
    </div>
  );
}
