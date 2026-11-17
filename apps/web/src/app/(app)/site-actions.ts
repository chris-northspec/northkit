'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ALL_SITES, cookieOptions, requireSession, SITE_COOKIE } from '@/lib/server/session';

/**
 * Back to the page the filter was used on (same origin only), or home, without any
 * `?site=` it had: the new choice applies there.
 */
async function backPath(): Promise<string> {
  const h = await headers();
  const referer = h.get('referer');
  const host = h.get('host');
  if (!referer || !host) return '/';
  try {
    const url = new URL(referer);
    if (url.host !== host || !url.pathname.startsWith('/')) return '/';
    url.searchParams.delete('site');
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

/**
 * The site filter: remembers the choice in this browser. "All" is remembered too, so
 * the home site doesn't come back; a site outside the user's scope counts as "all".
 */
export async function chooseSiteAction(form: FormData): Promise<never> {
  const session = await requireSession();
  const siteId = form.get('siteId');
  const value =
    typeof siteId === 'string' && session.actor.siteIds.includes(siteId) ? siteId : ALL_SITES;
  (await cookies()).set(SITE_COOKIE, value, { ...cookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  redirect(await backPath());
}
