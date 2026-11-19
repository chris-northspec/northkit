'use client';

// What the phone keeps so nothing is lost with no signal, when the app is closed, or when
// the phone restarts (S3-6, ADR 0004): a queue of changes in the order they were made, each
// with its client id, and a copy of the kit data the screens search. IndexedDB holds it,
// per signed-in person, so a shared phone never sends one person's work as someone else's.
// The queue pattern is NorthKeep's offline runner, copied and simplified (CHANGELOG).

const DB_NAME = 'northkit-offline';
const DB_VERSION = 1;

export type OpKind = 'check_out' | 'check_in' | 'missing' | 'stocktake_start' | 'stocktake_scan';

export interface QueuedOp {
  /** Set by IndexedDB: the queue order. */
  seq?: number;
  /** The change's client id (also the id of the movement or the stocktake it makes). */
  opId: string;
  userId: string;
  kind: OpKind;
  /** What it is, for the banner and the list ("Check out FB-000123 to Sam Hart"). */
  label: string;
  /** Where to look at it again. */
  href: string;
  /** The request body (without `kind`). */
  payload: Record<string, unknown>;
  /** The record it belongs to: a refused change holds back later ones for the same record. */
  group: string;
  createdAt: number;
  /** Set when the server refused it for good: kept and shown, never dropped. */
  error?: string | null;
}

export interface StoredSnapshot {
  userId: string;
  savedAt: number;
  data: unknown;
}

export interface LocalScan {
  key: string;
  userId: string;
  stocktakeId: string;
  /** Items scanned in this count on this phone, in order. */
  items: { id: string; assetNumber: string }[];
  locationId: string;
  startedAt: number;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const queue = db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
      queue.createIndex('byUser', 'userId');
      db.createObjectStore('snapshot', { keyPath: 'userId' });
      db.createObjectStore('scans', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('This browser can’t keep work offline.'));
    };
  });
  return opening;
}

function done<T = unknown>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('Saving on this phone failed.'));
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

const listeners = new Set<() => void>();

/** Called whenever the queue changes, in this tab. */
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed() {
  for (const l of listeners) l();
}

// ---------------------------------------------------------------- the queue

export async function queuedOps(userId: string): Promise<QueuedOp[]> {
  const all = await done<QueuedOp[]>(
    (await store('queue', 'readonly')).index('byUser').getAll(userId),
  );
  return all.sort((a, b) => a.seq! - b.seq!);
}

/** Changes not yet sent, for the banner. */
export async function unsyncedCount(userId: string): Promise<{ waiting: number; refused: number }> {
  const ops = await queuedOps(userId);
  return {
    waiting: ops.filter((o) => !o.error).length,
    refused: ops.filter((o) => o.error).length,
  };
}

export async function enqueue(op: Omit<QueuedOp, 'seq' | 'createdAt'>): Promise<void> {
  await done((await store('queue', 'readwrite')).add({ ...op, createdAt: Date.now() }));
  changed();
}

/** Removes a sent change. */
export async function removeOp(seq: number, opId: string): Promise<void> {
  const s = await store('queue', 'readwrite');
  const current = await done<QueuedOp | undefined>(s.get(seq));
  if (current && current.opId === opId) await done(s.delete(seq));
  changed();
}

export async function markRefused(op: QueuedOp, error: string): Promise<void> {
  await done((await store('queue', 'readwrite')).put({ ...op, error }));
  changed();
}

/** Removes a change for good: only when the person chooses to, after seeing why it was refused. */
export async function discardOp(seq: number): Promise<void> {
  await done((await store('queue', 'readwrite')).delete(seq));
  changed();
}

/** Puts a refused change back in line to be sent again. */
export async function retryOp(op: QueuedOp): Promise<void> {
  await done((await store('queue', 'readwrite')).put({ ...op, error: null }));
  changed();
}

/** Forgets everything for a person (sign-out): the queue is cleared with their session. */
export async function clearUser(userId: string): Promise<void> {
  for (const op of await queuedOps(userId))
    await done((await store('queue', 'readwrite')).delete(op.seq!));
  await done((await store('snapshot', 'readwrite')).delete(userId));
  changed();
}

// ---------------------------------------------------------------- the kit copy and counts

export async function putSnapshot(userId: string, data: unknown): Promise<void> {
  await done((await store('snapshot', 'readwrite')).put({ userId, savedAt: Date.now(), data }));
}

export async function getSnapshot(userId: string): Promise<StoredSnapshot | undefined> {
  return done<StoredSnapshot | undefined>((await store('snapshot', 'readonly')).get(userId));
}

const scanKey = (userId: string, stocktakeId: string) => `${userId}:${stocktakeId}`;

export async function getScans(
  userId: string,
  stocktakeId: string,
): Promise<LocalScan | undefined> {
  return done<LocalScan | undefined>(
    (await store('scans', 'readonly')).get(scanKey(userId, stocktakeId)),
  );
}

export async function putScans(scan: Omit<LocalScan, 'key'>): Promise<void> {
  await done(
    (await store('scans', 'readwrite')).put({
      ...scan,
      key: scanKey(scan.userId, scan.stocktakeId),
    }),
  );
}
