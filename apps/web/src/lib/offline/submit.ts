'use client';

import { discardOp, enqueue, queuedOps, type QueuedOp } from './store';
import { flush } from './sync';

// Every change made on a phone goes through the queue, online or not (S3-6): it is saved on
// the phone first, then sent. One path means the offline case is the normal case, not a
// special one. When the phone is online and the server refuses a change straight away, the
// person sees the reason on the screen and the change is dropped from the queue (they have
// read it). A change made offline, and refused when it is finally sent, is kept and shown on
// the Changes not sent yet page instead.

export type NewOp = Omit<QueuedOp, 'seq' | 'createdAt' | 'userId' | 'error'>;

export interface SubmitResult {
  /** Changes saved on this phone and now sent (or waiting, if offline). */
  saved: number;
  /** True if they have all been sent to the server. */
  sent: boolean;
  /** Offline: saved on the phone to send later. */
  waiting: number;
  refused: { label: string; error: string }[];
}

export async function submit(userId: string, ops: NewOp[]): Promise<SubmitResult> {
  for (const op of ops) await enqueue({ ...op, userId });
  const online = typeof navigator !== 'undefined' && navigator.onLine;
  if (!online) return { saved: ops.length, sent: false, waiting: ops.length, refused: [] };
  await flush(userId).catch(() => undefined);
  const mine = new Set(ops.map((o) => o.opId));
  const left = (await queuedOps(userId)).filter((o) => mine.has(o.opId));
  const refused: SubmitResult['refused'] = [];
  for (const op of left)
    if (op.error) {
      refused.push({ label: op.label, error: op.error });
      await discardOp(op.seq!);
    }
  const waiting = left.filter((o) => !o.error).length;
  return { saved: ops.length, sent: waiting === 0, waiting, refused };
}

export const newId = (): string => crypto.randomUUID();
