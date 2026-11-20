'use client';

import { useId, useState } from 'react';
import { KindChip } from '@/components/ui/kind-icon';
import { CameraScanner } from './scanner';
import {
  findByCode,
  search,
  STATUS_WORDS,
  type OfflineSnapshot,
  type SnapshotItem,
} from '@/lib/offline/snapshot';

// Finding an item on a phone (S3-2): scan its label, or type part of its asset number. It
// searches the copy of the register on the phone, so it works the same with no signal. A
// scanned label that isn't known says so in words; the screen never guesses.

export function ItemPicker({
  snapshot,
  onPick,
  disabledWhy,
  scanLabel = 'Scan a label',
  keepCameraOpen = false,
  onMessage,
}: {
  snapshot: OfflineSnapshot;
  onPick: (item: SnapshotItem) => void;
  /** Why an item can't be picked here, or null if it can. */
  disabledWhy?: (item: SnapshotItem) => string | null;
  scanLabel?: string;
  keepCameraOpen?: boolean;
  /** A problem with a scan, shown by the screen (with a shake). */
  onMessage?: (message: string | null) => void;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const results = search(snapshot, text);

  const pick = (item: SnapshotItem) => {
    const why = disabledWhy?.(item) ?? null;
    onMessage?.(why ? `${item.a}: ${why}` : null);
    if (why) return;
    setText('');
    onPick(item);
  };

  const scanned = (code: string) => {
    const item = findByCode(snapshot, code);
    if (!item) {
      onMessage?.(
        'That label isn’t one of this depot’s kit. Check it is a NorthKit label for your depot.',
      );
      return;
    }
    pick(item);
  };

  return (
    <div className="stack">
      <CameraScanner onCode={scanned} label={scanLabel} keepOpen={keepCameraOpen} />
      <div className="field">
        <label htmlFor={id}>Or type the asset number</label>
        <input
          id={id}
          className="input"
          type="search"
          autoComplete="off"
          autoCapitalize="characters"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const exact = findByCode(snapshot, text);
            if (exact) pick(exact);
            else if (results.length === 1) pick(results[0]!);
            else if (text.trim()) onMessage?.(`No item matches “${text.trim()}”.`);
          }}
          placeholder="FB-000123"
        />
      </div>
      {results.length ? (
        <ul className="scan-results" aria-label="Matching items">
          {results.map((item) => {
            const why = disabledWhy?.(item) ?? null;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => pick(item)}
                  aria-disabled={why ? true : undefined}
                >
                  <KindChip kindName={item.k} />
                  <span className="grow">
                    <strong>{item.a}</strong>{' '}
                    <span className="muted small">
                      {item.k} · {STATUS_WORDS[item.s]}
                      {why ? ` · ${why}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
