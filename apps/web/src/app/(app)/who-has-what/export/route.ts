import { can, whoHasWhatCsv, whoViewFrom } from '@northkit/core';
import { db } from '@/lib/server/db';
import { currentSession, siteSelection } from '@/lib/server/session';

/** Who-has-what as a CSV, for the view and depot on screen (S3-4). Formula-safe. */
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session || !can(session.actor, 'checkouts.view'))
    return new Response('Not found', { status: 404 });
  const view = whoViewFrom(new URL(request.url).searchParams.get('view') ?? undefined);
  const selection = await siteSelection();
  const csv = await whoHasWhatCsv(
    db(),
    session.actor,
    view,
    selection.current ? [selection.current.id] : undefined,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="northkit-who-has-what-${view}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
