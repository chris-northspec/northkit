import { offlineSnapshot } from '@northkit/core';
import { apiError, apiSession, json } from '@/lib/server/api';
import { db } from '@/lib/server/db';

// The copy of the register's kit a phone keeps for use with no signal (S3-6): items with
// their label codes, places and people, for the depots this person works at. It is only
// what they can already see and print. The phone's changes are decided by the server when
// they arrive, never by this copy.

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const session = await apiSession(request);
  if (session instanceof Response) return session;
  try {
    const snapshot = await offlineSnapshot(db(), session.actor, session.user.displayName);
    return json(snapshot as unknown as Record<string, unknown>);
  } catch (error) {
    return apiError(error);
  }
}
