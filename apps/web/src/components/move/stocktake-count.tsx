'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KindChip } from '@/components/ui/kind-icon';
import { getScans, putScans } from '@/lib/offline/store';
import { newId, submit } from '@/lib/offline/submit';
import { flush } from '@/lib/offline/sync';
import type { OfflineSnapshot, SnapshotItem } from '@/lib/offline/snapshot';
import { ItemPicker } from './item-picker';
import { MoveShell, ScanError, StepHead } from './move-shell';

// The counting screen (S3-5, S3-6): scan everything physically in the location. Each scan is
// saved on the phone and sent like any other change, so a stocktake works with no signal and
// survives the app closing or the phone restarting. The result and closing happen on the
// server, which is the record of truth, once the scans have been sent.

export function StocktakeCount() {
  return (
    <MoveShell keepPath="/stocktake/count">
      {({ snapshot, userId }) => <Count snapshot={snapshot} userId={userId} />}
    </MoveShell>
  );
}

function Count({ snapshot, userId }: { snapshot: OfflineSnapshot; userId: string }) {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const loc = params.get('loc') ?? '';
  const place = snapshot.places.find((p) => p.id === loc);
  const [scanned, setScanned] = useState<{ id: string; assetNumber: string }[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    void getScans(userId, id).then((s) => !stopped && setScanned(s?.items ?? []));
    return () => {
      stopped = true;
    };
  }, [userId, id]);

  if (!id || !loc) return <ScanError message="Open a count from the Stocktake page." />;
  if (scanned === null) return <p className="muted">Looking at this phone…</p>;

  const pick = async (item: SnapshotItem) => {
    if (scanned.some((s) => s.id === item.id)) {
      setMessage(`${item.a} is already counted.`);
      return;
    }
    setMessage(null);
    const next = [...scanned, { id: item.id, assetNumber: item.a }];
    setScanned(next);
    setLast(item.a);
    await putScans({
      userId,
      stocktakeId: id,
      items: next,
      locationId: loc,
      startedAt: Date.now(),
    });
    const opId = newId();
    await submit(userId, [
      {
        opId,
        kind: 'stocktake_scan',
        label: `Count ${item.a} in ${place?.name ?? 'the location'}`,
        href: `/stocktake/${id}`,
        group: `stocktake:${id}`,
        payload: { stocktakeId: id, itemId: item.id, occurredAt: new Date().toISOString() },
      },
    ]).then((r) => {
      if (r.refused.length) setMessage(r.refused[0]!.error);
    });
  };

  return (
    <>
      <StepHead
        step={1}
        title={`Count ${place?.name ?? 'this location'}`}
        hint="Scan everything that is physically here."
      />
      <p className="summary-strip">
        <span className="figure" data-testid="scanned-count">
          {scanned.length}
        </span>
        <span className="muted">counted so far{last ? ` · last ${last}` : ''}</span>
      </p>
      <ItemPicker
        snapshot={snapshot}
        keepCameraOpen
        scanLabel="Scan a label"
        onMessage={setMessage}
        onPick={(i) => void pick(i)}
      />
      <ScanError message={message} />
      {scanned.length ? (
        <ul className="scan-list" aria-label="Counted here">
          {[...scanned]
            .reverse()
            .slice(0, 30)
            .map((s) => {
              const item = snapshot.items.find((i) => i.id === s.id);
              return (
                <li key={s.id} className="scan-item">
                  {item ? <KindChip kindName={item.k} /> : null}
                  <span className="grow">
                    <strong>{s.assetNumber}</strong>
                  </span>
                </li>
              );
            })}
        </ul>
      ) : null}
      <div className="sticky-bottom scan-actions">
        <button
          type="button"
          className="scan-btn scan-btn-primary"
          disabled={finishing}
          onClick={() => {
            // The result is worked out on the server from what it holds, so every scan must
            // have been sent first. With no signal there is nothing to show yet.
            if (!navigator.onLine) {
              setMessage(
                'There is no connection, so the result can’t be worked out yet. Your scans are saved on this phone and will be counted when they are sent. Come back to this count when you are online.',
              );
              return;
            }
            setFinishing(true);
            void flush(userId)
              .catch(() => undefined)
              .then(() => router.push(`/stocktake/${id}`));
          }}
        >
          {finishing ? 'Sending your scans…' : 'Finish scanning: see the result'}
        </button>
        <p className="muted small">
          The result needs a connection, and is worked out from what the register holds once your
          scans have been sent.
        </p>
      </div>
    </>
  );
}
