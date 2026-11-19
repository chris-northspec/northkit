'use client';

import type { OfflineSnapshot, SnapshotItem } from '@northkit/core';
import { getSnapshot, putSnapshot } from './store';
import { SYNC_HEADER } from './sync';

// The phone's copy of the kit data (S3-6): fetched whenever a screen that needs it opens
// with a connection, kept in IndexedDB, and used when there is none. The copy only finds
// items and offers places and people; the server decides every change when it arrives.

export type { OfflineSnapshot, SnapshotItem };

export interface LoadedSnapshot {
  snapshot: OfflineSnapshot;
  /** True if it came from this phone because the server couldn't be reached. */
  stale: boolean;
}

/** The newest copy: from the server if it can be reached, otherwise the one on this phone. */
export async function loadSnapshot(userId: string): Promise<LoadedSnapshot | null> {
  try {
    const response = await fetch('/api/offline/kit', {
      headers: { [SYNC_HEADER]: '1' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.ok) {
      const snapshot = (await response.json()) as OfflineSnapshot;
      if (snapshot.user?.id === userId) {
        await putSnapshot(userId, snapshot).catch(() => undefined);
        return { snapshot, stale: false };
      }
    }
  } catch {
    // No signal: use the copy on the phone.
  }
  const stored = await getSnapshot(userId).catch(() => undefined);
  return stored ? { snapshot: stored.data as OfflineSnapshot, stale: true } : null;
}

/** The label code in a scanned QR (its address ends /i/<code>), or the text as typed. */
export function codeFrom(scanned: string): string {
  const text = scanned.trim();
  const m = /\/i\/([A-Za-z0-9_-]{20,})\/?(?:[?#].*)?$/.exec(text);
  return m ? m[1]! : text;
}

/** Finds the item a scan or a typed asset number means. */
export function findByCode(snapshot: OfflineSnapshot, scanned: string): SnapshotItem | undefined {
  const code = codeFrom(scanned);
  const upper = code.toUpperCase();
  return (
    snapshot.items.find((i) => i.t === code) ??
    snapshot.items.find((i) => i.a.toUpperCase() === upper)
  );
}

/** Items whose asset number, kind or text matches what was typed (the first twenty). */
export function search(snapshot: OfflineSnapshot, text: string): SnapshotItem[] {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: SnapshotItem[] = [];
  for (const i of snapshot.items) {
    if (i.a.toLowerCase().includes(q) || i.k.toLowerCase().includes(q)) {
      out.push(i);
      if (out.length >= 20) break;
    }
  }
  return out;
}

export const STATUS_WORDS: Record<string, string> = {
  available: 'Available',
  out: 'Out',
  in_transit: 'In transit',
  quarantined: 'Quarantined',
  missing: 'Missing',
  retired: 'Retired',
};

/** Why an item can't be checked out, as the copy on the phone knows it. */
export function whyNotAvailable(item: SnapshotItem): string | null {
  switch (item.s) {
    case 'available':
      return null;
    case 'out':
      return 'It is already out. Check it in first.';
    case 'quarantined':
      return 'It is quarantined and can’t be checked out until a passed inspection is recorded.';
    case 'missing':
      return 'It is reported missing. Record it as found first.';
    case 'in_transit':
      return 'It is in transit to another depot.';
    default:
      return 'It can’t be checked out.';
  }
}

/** Today's date (yyyy-mm-dd) in a depot's time zone, plus some days. */
export function dateIn(zone: string, plusDays: number, now = new Date()): string {
  const when = new Date(now.getTime() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}
