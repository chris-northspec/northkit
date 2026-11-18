import { can, isLabelLayout, printLabels, type LabelLayout } from '@northkit/core';
import { firstValues } from '@/lib/list-filters';
import { db } from '@/lib/server/db';
import { isUuid } from '@/lib/server/load';
import { itemFilters, type ItemParams } from '@/lib/server/item-params';
import { currentSession } from '@/lib/server/session';

/**
 * A PDF of QR labels (S2-4): named items (?ids=a,b) or everything the list's filters
 * match, in a chosen layout, optionally with the company name and with some slots of a
 * part-used sheet skipped. Print at 100% (no "fit to page").
 */
export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session || !can(session.actor, 'items.view'))
    return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const params = firstValues(Object.fromEntries(url.searchParams)) as ItemParams & {
    ids?: string;
    layout?: string;
    skip?: string;
    company?: string;
  };
  const layout: LabelLayout['id'] =
    params.layout && isLabelLayout(params.layout) ? params.layout : 'a4-21';
  const ids = params.ids ? params.ids.split(',').filter(isUuid).slice(0, 2000) : null;
  const { page: _page, ...filters } = itemFilters(params);
  void _page;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  const { pdf, count } = await printLabels(db(), session.actor, ids ? { ids } : { filters }, {
    layout,
    skip: Math.max(0, Number(params.skip) || 0),
    showCompany: params.company === '1',
    baseUrl: host ? `${proto}://${host}` : undefined,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="northkit-labels-${count}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
