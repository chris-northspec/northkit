import type { Metadata } from 'next';
import { OfflineQueueList } from '@/components/offline/queue-list';
import { requireSession } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Changes not sent yet' };

/**
 * Everything on this phone not yet sent (S3-6): check-outs, check-ins, missing reports and
 * stocktake scans, oldest first. A change the server refused is kept here with the reason, to
 * try again or (only by choice) discard. The server is the record of truth, so a change that no
 * longer fits is never applied silently.
 */
export default async function SyncPage() {
  await requireSession();
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Movements</p>
          <h1>Changes not sent yet</h1>
        </div>
      </div>
      <p className="muted">
        What you did with no signal is kept on this phone and sent in order when there is a
        connection. Anything the server could not accept stays here, with the reason, until you try
        again or discard it.
      </p>
      <section className="card" aria-label="On this phone">
        <OfflineQueueList />
      </section>
    </>
  );
}
