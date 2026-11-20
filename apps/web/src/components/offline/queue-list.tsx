'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOfflineUser } from '@/components/offline/offline-user';
import { discardOp, onQueueChange, queuedOps, retryOp, type QueuedOp } from '@/lib/offline/store';

// What is still on this phone: waiting to be sent, or refused by the server with its reason
// (S3-6: a refused change is kept and shown, never applied silently and never dropped).
// "Try again" puts it back in line; "Discard" removes it, only by choice.

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function OfflineQueueList() {
  const user = useOfflineUser();
  const [ops, setOps] = useState<QueuedOp[] | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const load = () =>
      void queuedOps(user.id)
        .then((all) => {
          if (!stopped) setOps(all);
        })
        .catch(() => {
          if (!stopped) setOps([]);
        });
    load();
    const unsubscribe = onQueueChange(load);
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [user]);

  if (!ops) return <p className="muted">Looking at this phone…</p>;
  if (!ops.length)
    return (
      <p className="muted" role="status">
        Everything has been sent.
      </p>
    );
  return (
    <ul className="scan-list" aria-label="On this phone">
      {ops.map((op) => (
        <li key={op.seq} className="scan-item scan-item-stack">
          <div className="row">
            <span className="grow">
              <Link href={op.href}>
                <strong>{op.label}</strong>
              </Link>{' '}
              <span className="muted small">made {when.format(new Date(op.createdAt))}</span>
            </span>
            <span className={op.error ? 'badge badge-danger' : 'badge badge-warning'}>
              {op.error ? 'Not applied' : 'Waiting to send'}
            </span>
          </div>
          {op.error ? (
            <>
              <p className="scan-error" role="alert">
                <span>{op.error}</span>
              </p>
              <p className="muted small">
                The server is the record of truth, so this wasn’t applied. It is kept here until you
                try again or discard it.
              </p>
              <div className="row">
                <button type="button" className="button" onClick={() => void retryOp(op)}>
                  Try again
                </button>
                {confirming === op.seq ? (
                  <>
                    <button
                      type="button"
                      className="button button-danger"
                      onClick={() => {
                        setConfirming(null);
                        void discardOp(op.seq!);
                      }}
                    >
                      Yes, discard it
                    </button>
                    <button type="button" className="button" onClick={() => setConfirming(null)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button button-link"
                    onClick={() => setConfirming(op.seq!)}
                  >
                    Discard
                  </button>
                )}
              </div>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
