import { checkIn, checkOut, reportMissing, scanStocktake, startStocktake } from '@northkit/core';
import { apiError, apiSession, json } from '@/lib/server/api';
import { db } from '@/lib/server/db';

// The one endpoint the phone's queue sends to (S3-6). Each change carries its client id, and
// the server applies a replay once: the answer for a repeat is the same as the first time, so
// sending again is always safe. The server is the record of truth: a change that no longer
// fits (the item was quarantined, or someone else checked it out) is refused with the
// reason, and the phone keeps it and shows it; nothing is ever applied silently.

export const dynamic = 'force-dynamic';

type Body = { kind?: string } & Record<string, unknown>;

export async function POST(request: Request): Promise<Response> {
  const session = await apiSession(request);
  if (session instanceof Response) return session;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'That change couldn’t be read.' }, 400);
  }
  const actor = session.actor;
  try {
    switch (body.kind) {
      case 'check_out': {
        const r = await checkOut(db(), actor, body as never);
        return json({ ok: true, ...r });
      }
      case 'check_in': {
        const r = await checkIn(db(), actor, body as never);
        return json({ ok: true, ...r });
      }
      case 'missing': {
        const r = await reportMissing(db(), actor, body as never);
        return json({ ok: true, ...r });
      }
      case 'stocktake_start': {
        const r = await startStocktake(db(), actor, body as never);
        return json({ ok: true, stocktakeId: r.id, message: `Counting ${r.locationName}.` });
      }
      case 'stocktake_scan': {
        const r = await scanStocktake(db(), actor, body as never);
        return json({ ok: true, message: `${r.assetNumber} counted.`, replayed: r.already });
      }
      default:
        return json({ error: 'That kind of change isn’t known.' }, 400);
    }
  } catch (error) {
    return apiError(error);
  }
}
