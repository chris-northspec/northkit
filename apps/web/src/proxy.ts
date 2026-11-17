import { NextResponse, type NextRequest } from 'next/server';
import { SITE_PARAM_HEADER } from '@/lib/server/site-param';

/**
 * Passes `?site=<code>` on to the page as a request header, so the shell's site filter
 * and the page agree on the site a drill-down link or bookmark names (B-2). Any copy of
 * the header sent by the client is replaced. Whether the code is one of the user's
 * sites is decided later, in siteSelection(); this only carries it.
 */
export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(SITE_PARAM_HEADER);
  const site = request.nextUrl.searchParams.get('site');
  if (site && /^[A-Za-z0-9_-]{1,20}$/.test(site)) headers.set(SITE_PARAM_HEADER, site);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not Next's own files, the API or photos.
  matcher: ['/((?!_next/|api/|photos/|favicon|manifest).*)'],
};
