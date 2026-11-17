import 'server-only';
import {
  demoOrigin,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type ActiveSession,
} from '@northkit/core';
import { isReadOnlyViolation } from '@northkit/db';
import { READ_ONLY_MESSAGE } from './actions';
import { currentSession } from './session';

// JSON endpoints for the phone's offline queue (used from Sprint 3: check-out and in,
// and pre-use checks, work offline and sync later). Each answer tells the phone whether to
// try again later (retry) or show the refusal: nothing queued is ever dropped silently.

/** The sync header every queue request sends. A form on another site can't set it. */
export const SYNC_HEADER = 'x-northkit-sync';

export function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * The signed-in session for a queue request, or the response to send instead. Needs the
 * sync header and, when the browser says where it came from, the same origin (CSRF).
 */
export async function apiSession(request: Request): Promise<ActiveSession | Response> {
  if (request.headers.get(SYNC_HEADER) !== '1') return json({ error: 'Not allowed.' }, 403);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // The same origin, or the demo link's (docs/demo-link.md) if a proxy rewrote the Host.
  const from = origin ? new URL(origin).host : null;
  if (from && host && from !== host && from !== demoOrigin()?.host)
    return json({ error: 'Not allowed.' }, 403);
  const session = await currentSession();
  if (!session || session.user.mustChangePassword || session.user.mfaSetupRequired)
    return json({ error: 'Sign in again to send your changes.', retry: true }, 401);
  return session;
}

/** A refusal as JSON, saying whether the phone should keep it and try again. */
export function apiError(error: unknown): Response {
  if (error instanceof ValidationError)
    return json({ error: error.message, fields: error.fields }, 400);
  if (error instanceof NotFoundError) return json({ error: error.message }, 404);
  if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
  if (error instanceof ConflictError) return json({ error: error.message }, 409);
  if (error instanceof DomainError) return json({ error: error.message }, 400);
  // The licence has lapsed: kept on the phone until it is renewed (S1-7).
  if (isReadOnlyViolation(error)) return json({ error: READ_ONLY_MESSAGE, retry: true }, 423);
  throw error;
}

/** An image served through a permission check: private, typed from its checked bytes. */
export function imageResponse(photo: { type: string; bytes: Buffer }): Response {
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.type,
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
