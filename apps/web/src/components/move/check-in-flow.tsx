'use client';

import { useState } from 'react';
import { KindChip } from '@/components/ui/kind-icon';
import { STATUS_WORDS, type OfflineSnapshot, type SnapshotItem } from '@/lib/offline/snapshot';
import { newId, submit, type SubmitResult } from '@/lib/offline/submit';
import { ItemPicker } from './item-picker';
import { Done, MoveShell, ScanError, StepHead } from './move-shell';

// Check in (S3-2): scan the item, choose where it is returned to (the depot's own store
// unless you say otherwise) and add a note on its condition.

export function CheckInFlow({ initialItemId }: { initialItemId?: string }) {
  return (
    <MoveShell keepPath="/move/in">
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
    snapshot.items.find((i) => i.id === initialItemId && i.s === 'out') ?? null,
  );
  const [placeId, setPlaceId] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: SubmitResult; line: string } | null>(null);

  const places = snapshot.places.filter((p) => item && p.siteId === item.d);
  const home = item ? snapshot.homeStores[item.d] : undefined;
  const chosen = placeId || home || '';

  const confirm = async () => {
    if (!item || !chosen) return;
    setBusy(true);
    const clientId = newId();
    const where = snapshot.places.find((p) => p.id === chosen)?.name ?? 'the store';
    const r = await submit(userId, [
      {
        opId: clientId,
        kind: 'check_in',
        label: `Check in ${item.a} to ${where}`,
        href: `/items/${item.id}`,
        group: `item:${item.id}`,
        payload: {
          clientId,
          itemId: item.id,
          locationId: chosen,
          note: note.trim() || null,
          occurredAt: new Date().toISOString(),
        },
      },
    ]);
    setBusy(false);
    setResult({ r, line: `${item.a} checked in to ${where}` });
  };

  const reset = () => {
    setItem(null);
    setPlaceId('');
    setNote('');
    setMessage(null);
    setResult(null);
  };

  if (result)
    return (
      <Done
        title="Checked in"
        result={result.r}
        lines={[result.line]}
        again={{ label: 'Check in another', onClick: reset }}
      />
    );

  if (!item)
    return (
      <>
        <StepHead step={1} title="Scan the item" hint="Scan the label of what you are returning." />
        <ItemPicker
          snapshot={snapshot}
          onMessage={setMessage}
          disabledWhy={(i) =>
            i.s === 'out'
              ? null
              : `${STATUS_WORDS[i.s]}: it isn’t out, so there is nothing to check in.`
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
      <StepHead step={2} title="Where is it going back to?" hint={`${item.a} · ${item.k}`} />
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
        <label htmlFor="back-to">Returned to</label>
        <select
          id="back-to"
          className="input"
          value={chosen}
          onChange={(e) => setPlaceId(e.target.value)}
        >
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code}){p.id === home ? ' · the depot’s store' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="condition">Condition note (optional)</label>
        <input
          id="condition"
          className="input"
          value={note}
          maxLength={1000}
          placeholder="Chuck a little loose"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="sticky-bottom scan-actions">
        <button
          type="button"
          className="scan-btn scan-btn-primary"
          disabled={busy || !chosen}
          onClick={() => void confirm()}
        >
          {busy ? 'Checking in…' : 'Check in'}
        </button>
      </div>
    </>
  );
}
