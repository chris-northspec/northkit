'use client';

import { backoffDelay } from '@northkit/core/retry';
import { markRefused, queuedOps, removeOp, type QueuedOp } from './store';

// Replays the queue to the server, oldest first (S3-6). A change that can't be sent now (no
// signal, a server error, signed out, read-only until a licence is installed) stops the
// replay and is retried later with exponential back-off and jitter; one the server refuses
// is kept and shown with the reason, never dropped. Each change carries its client id and
// the server applies a replay once, so sending again is always safe.

/** Header every sync request carries: a form on another site can't set it (CSRF). */
export const SYNC_HEADER = 'x-northkit-sync';

const REQUEST_TIMEOUT_MS = 30_000;

type Outcome =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'retry'; message: string }
  | { kind: 'refused'; message: string };

async function send(op: QueuedOp): Promise<Outcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [SYNC_HEADER]: '1' },
      body: JSON.stringify({ ...op.payload, kind: op.kind }),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { kind: 'ok', body };
    const message =
      typeof body.error === 'string' ? body.error : `The server said ${response.status}.`;
    // Transient: signed out, read-only until a licence is installed, rate limited, or the
    // server having a bad moment.
    if (
      body.retry === true ||
      [401, 408, 423, 429].includes(response.status) ||
      response.status >= 500
    )
      return { kind: 'retry', message };
    return { kind: 'refused', message };
  } catch {
    return { kind: 'retry', message: 'No connection.' };
  } finally {
    clearTimeout(timer);
  }
}

/** What the server did with the last change sent from this phone, for the banner. */
export interface SentNote {
  label: string;
  href: string;
  message: string;
}

const sentListeners = new Set<(note: SentNote) => void>();

export function onSent(listener: (note: SentNote) => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

export interface FlushResult {
  sent: number;
  /** Something is waiting to be retried. */
  waiting: boolean;
  lastError: string | null;
}

let running: Promise<FlushResult> | null = null;

/** Sends what it can, in order. Only one replay runs at a time in a tab. */
export function flush(userId: string): Promise<FlushResult> {
  running ??= (async () => {
    let sent = 0;
    const blocked = new Set<string>();
    try {
      for (const op of await queuedOps(userId)) {
        // A refused change holds back the later changes to the same record, never anyone else's.
        if (op.error) {
          blocked.add(op.group);
          continue;
        }
        if (blocked.has(op.group)) continue;
        const outcome = await send(op);
        if (outcome.kind === 'ok') {
          await removeOp(op.seq!, op.opId);
          sent += 1;
          const message = typeof outcome.body.message === 'string' ? outcome.body.message : 'Sent.';
          for (const l of sentListeners) l({ label: op.label, href: op.href, message });
        } else if (outcome.kind === 'retry') {
          return { sent, waiting: true, lastError: outcome.message };
        } else {
          await markRefused(op, outcome.message);
          blocked.add(op.group);
        }
      }
      return { sent, waiting: false, lastError: null };
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Delay before retry `attempt` (0-based), from the shared back-off: exponential, capped at
 * a minute, with jitter. Unlike the shared helper this queue never gives up, because what
 * it holds exists nowhere else; half the cap is a floor, so a phone that has been offline a
 * while doesn't retry in a tight loop.
 */
export function retryDelay(attempt: number, random = Math.random): number {
  const cap = Math.min(60_000, 2_000 * 2 ** attempt);
  return Math.round(cap / 2 + backoffDelay(attempt, { baseMs: 1_000, maxMs: 30_000, random }));
}
