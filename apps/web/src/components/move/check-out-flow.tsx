'use client';

import { Building2, Store, Truck, User, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { KindChip } from '@/components/ui/kind-icon';
import {
  dateIn,
  whyNotAvailable,
  type OfflineSnapshot,
  type SnapshotItem,
} from '@/lib/offline/snapshot';
import { newId, submit, type SubmitResult } from '@/lib/offline/submit';
import { ItemPicker } from './item-picker';
import { Done, MoveShell, ScanError, StepHead } from './move-shell';

// Check out (S3-2, A10): scan or search for one item or several, choose where they are going
// (to me, my van, a site, a store or a person), set an optional due-back date and confirm.
// One step per screen, targets of at least 56 px. Several items go to ONE destination.

type DestinationKind = 'me' | 'my_van' | 'site' | 'store' | 'person';

// The words on the five big buttons (the same as the server's DESTINATION_LABELS, which a
// client bundle can't import).
const DESTINATION_LABELS: Record<DestinationKind, string> = {
  me: 'To me',
  my_van: 'To my van',
  site: 'To a site',
  store: 'To a store',
  person: 'To a person',
};

const ICONS = {
  me: User,
  my_van: Truck,
  site: Building2,
  store: Store,
  person: UserRound,
} as const;

export function CheckOutFlow({ initialItemId }: { initialItemId?: string }) {
  return (
    <MoveShell keepPath="/move/out">
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
  const first = initialItemId ? snapshot.items.find((i) => i.id === initialItemId) : undefined;
  const [items, setItems] = useState<SnapshotItem[]>(
    first && !whyNotAvailable(first) ? [first] : [],
  );
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<DestinationKind | null>(null);
  const [placeId, setPlaceId] = useState('');
  const [personId, setPersonId] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: SubmitResult; lines: string[] } | null>(null);

  const depot = items[0]?.d;
  const places = snapshot.places.filter((p) => !depot || p.siteId === depot);
  const myVans = places.filter((p) => p.kind === 'van' && p.assignedToMe);
  const people = snapshot.people.filter((p) => !depot || p.siteIds.includes(depot));
  const choices = useMemo(() => {
    const out: DestinationKind[] = ['me'];
    if (myVans.length) out.push('my_van');
    if (snapshot.can.issueToOthers) {
      if (places.some((p) => p.kind === 'site')) out.push('site');
      if (places.some((p) => p.kind === 'store' || p.kind === 'yard')) out.push('store');
      if (people.length) out.push('person');
    }
    return out;
  }, [snapshot, depot]);

  const defaultDue = () => {
    const zone = snapshot.timeZones[depot ?? ''] ?? 'Europe/London';
    const days = Math.max(...items.map((i) => i.n), 1);
    return dateIn(zone, days);
  };
  const goesOut = kind === 'me' || kind === 'my_van' || kind === 'person' || kind === 'site';

  const destination = () => {
    if (!kind) return null;
    if (kind === 'me') return { kind } as const;
    if (kind === 'my_van') return { kind, locationId: myVans[0]?.id } as const;
    if (kind === 'person') return { kind, userId: personId } as const;
    return { kind, locationId: placeId } as const;
  };
  const destinationLabel = () => {
    if (kind === 'me') return 'you';
    if (kind === 'my_van') return myVans[0]?.name ?? 'your van';
    if (kind === 'person')
      return snapshot.people.find((p) => p.id === personId)?.name ?? 'that person';
    return snapshot.places.find((p) => p.id === placeId)?.name ?? 'that place';
  };

  const confirm = async () => {
    const dest = destination();
    if (!dest || !items.length) return;
    setBusy(true);
    const at = new Date().toISOString();
    const to = destinationLabel();
    const r = await submit(
      userId,
      items.map((i) => {
        const clientId = newId();
        return {
          opId: clientId,
          kind: 'check_out' as const,
          label: `Check out ${i.a} to ${to}`,
          href: `/items/${i.id}`,
          group: `item:${i.id}`,
          payload: {
            clientId,
            itemId: i.id,
            destination: dest,
            dueBackOn: goesOut && due ? due : null,
            note: note.trim() || null,
            occurredAt: at,
          },
        };
      }),
    );
    setBusy(false);
    setResult({
      r,
      lines: items.map((i) => `${i.a} ${goesOut ? 'checked out to' : 'moved to'} ${to}`),
    });
  };

  const reset = () => {
    setItems([]);
    setStep(1);
    setKind(null);
    setPlaceId('');
    setPersonId('');
    setDue(null);
    setNote('');
    setMessage(null);
    setResult(null);
  };

  if (result) {
    const failed = new Set(result.r.refused.map((x) => x.label));
    return (
      <Done
        title="Checked out"
        result={result.r}
        lines={result.lines.filter(
          (l) => !failed.has(`Check out ${l.split(' ')[0]} to ${destinationLabel()}`),
        )}
        again={{ label: 'Check out more', onClick: reset }}
      />
    );
  }

  if (step === 1)
    return (
      <>
        <StepHead step={1} title="Scan the kit" hint="Scan one item, or several, then carry on." />
        <ItemPicker
          snapshot={snapshot}
          scanLabel={items.length ? 'Scan another' : 'Scan a label'}
          keepCameraOpen
          onMessage={setMessage}
          disabledWhy={(i) =>
            items.some((x) => x.id === i.id)
              ? 'Already in your list.'
              : (whyNotAvailable(i) ??
                (depot && i.d !== depot ? 'It is at another depot: send it as a transfer.' : null))
          }
          onPick={(i) => {
            setMessage(null);
            setItems((now) => [...now, i]);
          }}
        />
        <ScanError message={message} />
        {items.length ? (
          <ul className="scan-list" aria-label="Items to check out">
            {items.map((i) => (
              <li key={i.id} className="scan-item">
                <KindChip kindName={i.k} />
                <span className="grow">
                  <strong>{i.a}</strong>{' '}
                  <span className="muted small">
                    {i.k}
                    {i.p ? ` · kit of ${i.p}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="button remove"
                  aria-label={`Remove ${i.a}`}
                  onClick={() => setItems((now) => now.filter((x) => x.id !== i.id))}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="sticky-bottom">
          <button
            type="button"
            className="scan-btn scan-btn-primary"
            disabled={!items.length}
            onClick={() => setStep(2)}
          >
            {items.length
              ? `Next: where ${items.length === 1 ? 'is it' : 'are they'} going?`
              : 'Scan something first'}
          </button>
        </div>
      </>
    );

  if (step === 2)
    return (
      <>
        <StepHead
          step={2}
          title="Where is it going?"
          hint={items.length === 1 ? items[0]!.a : `${items.length} items, all to one place`}
        />
        <ul className="scan-choices" role="radiogroup" aria-label="Destination">
          {choices.map((c) => {
            const Icon = ICONS[c];
            return (
              <li key={c}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === c}
                  className="scan-btn"
                  onClick={() => {
                    setKind(c);
                    setPlaceId('');
                    setPersonId('');
                  }}
                >
                  <Icon size={22} className="icon" aria-hidden="true" />
                  {DESTINATION_LABELS[c]}
                  {c === 'my_van' && myVans[0] ? (
                    <span className="muted small"> · {myVans[0].name}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {kind === 'site' || kind === 'store' ? (
          <div className="field">
            <label htmlFor="place">
              {kind === 'site' ? 'Which job site?' : 'Which store or yard?'}
            </label>
            <select
              id="place"
              className="input"
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
            >
              <option value="">Choose…</option>
              {places
                .filter((p) =>
                  kind === 'site' ? p.kind === 'site' : p.kind === 'store' || p.kind === 'yard',
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        {kind === 'person' ? (
          <div className="field">
            <label htmlFor="person">Which person?</label>
            <select
              id="person"
              className="input"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Choose…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="sticky-bottom scan-actions">
          <button
            type="button"
            className="scan-btn scan-btn-primary"
            disabled={
              !kind ||
              ((kind === 'site' || kind === 'store') && !placeId) ||
              (kind === 'person' && !personId)
            }
            onClick={() => {
              setDue(goesOut ? defaultDue() : null);
              setStep(3);
            }}
          >
            Next
          </button>
          <button type="button" className="scan-btn" onClick={() => setStep(1)}>
            Back
          </button>
        </div>
      </>
    );

  return (
    <>
      <StepHead
        step={3}
        title="Check it out"
        hint={`${items.length === 1 ? items[0]!.a : `${items.length} items`} to ${destinationLabel()}`}
      />
      {goesOut ? (
        <div className="field">
          <label htmlFor="due">Due back (optional)</label>
          <input
            id="due"
            className="input"
            type="date"
            value={due ?? ''}
            min={dateIn(snapshot.timeZones[depot ?? ''] ?? 'Europe/London', 0)}
            onChange={(e) => setDue(e.target.value || null)}
          />
          <span className="hint">
            Offered from the kind’s usual time out. Clear it for no date.
          </span>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <input
          id="note"
          className="input"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="sticky-bottom scan-actions">
        <button
          type="button"
          className="scan-btn scan-btn-primary"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy
            ? 'Checking out…'
            : items.length === 1
              ? 'Check out'
              : `Check out ${items.length} items`}
        </button>
        <button type="button" className="scan-btn" onClick={() => setStep(2)}>
          Back
        </button>
      </div>
    </>
  );
}
