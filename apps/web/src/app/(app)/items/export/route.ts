import { can, exportItemsCsv } from '@northkit/core';
import { firstValues } from '@/lib/list-filters';
import { db } from '@/lib/server/db';
import { itemFilters, type ItemParams } from '@/lib/server/item-params';
import { currentSession } from '@/lib/server/session';

/** The item list as a CSV, with the screen's filters (S2-2). Formula-safe; every match, not one page. */
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session || !can(session.actor, 'items.view'))
    return new Response('Not found', { status: 404 });
  const params = firstValues(Object.fromEntries(new URL(request.url).searchParams)) as ItemParams;
  const { page: _page, ...filters } = itemFilters(params);
  void _page;
  const csv = await exportItemsCsv(db(), session.actor, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="northkit-items-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
