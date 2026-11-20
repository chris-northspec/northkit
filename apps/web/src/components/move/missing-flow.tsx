'use client';

import { useState } from 'react';
import { KindChip } from '@/components/ui/kind-icon';
import { STATUS_WORDS, type OfflineSnapshot, type SnapshotItem } from '@/lib/offline/snapshot';
import { newId, submit, type SubmitResult } from '@/lib/offline/submit';
import { ItemPicker } from './item-picker';
import { Done, MoveShell, ScanError, StepHead } from './move-shell';

// Report missing (S3-2, CO-4): sets the item to missing, records who reported it and when,
// and puts it on the Needs action panel. A person records it as found, where it turned up.

export function MissingFlow({ initialItemId }: { initialItemId?: string }) {
  return (
    <MoveShell keepPath="/move/missing">
      {({ snapshot, userId }) => (
        <Flow snapshot={snapshot} userId={userId} initialItemId={initialItemId} />
      )}
    </MoveShell>
  );
}

function Flow({
  snapshot,
  userId,
  initialItemId,
}: {
  snapshot: OfflineSnapshot;
  userId: string;
  initialItemId?: string;
}) {
  const [item, setItem] = useState<SnapshotItem | null>(
    snapshot.items.find((i) => i.id === initialItemId && (i.s === 'available' || i.s === 'out')) ??
      null,
  );
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: SubmitResult; line: string } | null>(null);

  const confirm = async () => {
    if (!item) return;
    setBusy(true);
    const clientId = newId();
    const r = await submit(userId, [
      {
        opId: clientId,
        kind: 'missing',
        label: `Report ${item.a} missing`,
        href: `/items/${item.id}`,
        group: `item:${item.id}`,
        payload: {
          clientId,
          itemId: item.id,
          note: note.trim() || null,
          occurredAt: new Date().toISOString(),
        },
      },
    ]);
    setBusy(false);
    setResult({ r, line: `${item.a} reported missing` });
  };

  const reset = () => {
    setItem(null);
    setNote('');
    setMessage(null);
    setResult(null);
  };

  if (result)
    return (
      <Done
        title="Reported missing"
        result={result.r}
        lines={[result.line]}
        again={{ label: 'Report another', onClick: reset }}
      />
    );

  if (!item)
    return (
      <>
        <StepHead
          step={1}
          title="Which item is missing?"
          hint="Scan its label, or type the asset number."
        />
        <ItemPicker
          snapshot={snapshot}
          onMessage={setMessage}
          disabledWhy={(i) =>
            i.s === 'available' || i.s === 'out'
              ? null
              : `${STATUS_WORDS[i.s]}: it can’t be reported missing now.`
          }
          onPick={(i) => {
            setMessage(null);
            setItem(i);
          }}
        />
        <ScanError message={message} />
      </>
    );

  return (
    <>
      <StepHead step={2} title="Report it missing" hint={`${item.a} · ${item.k}`} />
      <div className="scan-item">
        <KindChip kindName={item.k} />
        <span className="grow">
          <strong>{item.a}</strong> <span className="muted small">{item.k}</span>
        </span>
        <button type="button" className="button" onClick={() => setItem(null)}>
          Change
        </button>
      </div>
      <div className="field">
        <label htmlFor="why">What happened? (optional)</label>
        <input
          id="why"
          className="input"
          value={note}
          maxLength={1000}
          placeholder="Not in the van after the Smith job"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <p className="muted">
        It will show on the needs-action panel until someone records it as found.
      </p>
      <div className="sticky-bottom scan-actions">
        <button
          type="button"
          className="scan-btn scan-btn-primary"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Reporting…' : 'Report missing'}
        </button>
      </div>
    </>
  );
}
