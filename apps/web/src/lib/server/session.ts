import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  can,
  clientAddress,
  demoOrigin,
  getSession,
  siteChoices,
  type ActiveSession,
  type Permission,
  type RequestInfo,
  type SiteChoice,
  trustedProxies,
} from '@northkit/core';
import { optionalEnv } from '@northkit/db';
import { db } from './db';
import { SITE_PARAM_HEADER } from './site-param';

// Copied from NorthCore WMS and adapted: no scanner routing; a user whose role needs
// two-factor is sent to set it up; the chosen site is remembered in a cookie.

export const SESSION_COOKIE = 'nk_session';
/** Holds the pending token between the password and two-factor steps. */
export const MFA_COOKIE = 'nk_mfa';
/** The site chosen in the site filter: a site id, or ALL_SITES; absent means the home site. */
export const SITE_COOKIE = 'nk_site';
/** Cookie value for "all my sites" chosen on purpose, so the home site doesn't take over. */
export const ALL_SITES = 'all';

/** Set by server/peer-address.mjs from the socket; any client copy is replaced. */
export const PEER_HEADER = 'x-northkit-peer';

export function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    // Browsers also accept secure cookies on http://localhost, so this stays on in development.
    secure: optionalEnv('NORTHKIT_COOKIE_SECURE') !== 'false',
    sameSite: 'lax' as const,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** The signed-in session for this request, or null. Cached per request. */
export const currentSession = cache(async (): Promise<ActiveSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? getSession(db(), token) : null;
});

export const CHANGE_PASSWORD_PATH = '/change-password';
export const TWO_FACTOR_PATH = '/account/two-factor';

/**
 * The signed-in session, or a redirect to sign in. A user who must change an issued
 * password, or set up two-factor sign-in their role requires, is sent there from every
 * page and action; their session carries no permissions or sites, so nothing else would
 * work anyway.
 */
export async function requireSession(
  options: { allowPasswordChange?: boolean; allowMfaSetup?: boolean } = {},
): Promise<ActiveSession> {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (session.user.mustChangePassword && !options.allowPasswordChange)
    redirect(CHANGE_PASSWORD_PATH);
  if (!session.user.mustChangePassword && session.user.mfaSetupRequired && !options.allowMfaSetup)
    redirect(TWO_FACTOR_PATH);
  return session;
}

/** A screen or action that needs a permission. Services check again; this only routes. */
export async function requirePermission(permission: Permission): Promise<ActiveSession> {
  const session = await requireSession();
  if (!can(session.actor, permission)) redirect('/');
  return session;
}

export function homeFor(session: Pick<ActiveSession, 'user'>): string {
  if (session.user.mustChangePassword) return CHANGE_PASSWORD_PATH;
  if (session.user.mfaSetupRequired) return TWO_FACTOR_PATH;
  return '/';
}

export interface SiteSelection {
  sites: SiteChoice[];
  /** The chosen site, or null for all of the user's sites. */
  current: SiteChoice | null;
  /** What "all" is called for this user: "All depots" or "All my depots (n)". */
  allLabel: string;
  /** True when the choice came from `?site=` on this page's address (a link or bookmark). */
  fromLink: boolean;
}

/**
 * The site filter (B-2): which of the user's sites this page shows. In order, a
 * `?site=<code>` on the address (passed on by src/proxy.ts), the choice remembered in
 * the browser, the user's home site, or their only site; otherwise all their sites.
 * Anything naming a site outside the user's scope is ignored (fail closed): the
 * database's row-level security is the real limit, this only narrows within it.
 */
export const siteSelection = cache(async (): Promise<SiteSelection> => {
  const session = await currentSession();
  if (!session) return { sites: [], current: null, allLabel: 'All depots', fromLink: false };
  const sites = await siteChoices(db(), session.actor);
  const allLabel =
    session.actor.allSites || session.actor.administrator
      ? 'All depots'
      : `All my depots (${sites.length})`;
  const linked = (await headers()).get(SITE_PARAM_HEADER)?.trim().toUpperCase();
  const byLink = linked ? sites.find((s) => s.code === linked) : undefined;
  if (byLink) return { sites, current: byLink, allLabel, fromLink: true };
  const chosen = (await cookies()).get(SITE_COOKIE)?.value;
  const current =
    (chosen === ALL_SITES ? undefined : sites.find((s) => s.id === chosen)) ??
    (chosen === ALL_SITES ? undefined : sites.find((s) => s.id === session.user.homeSiteId)) ??
    // A single-site user always has that site chosen.
    (sites.length === 1 ? sites[0]! : null);
  return { sites, current: current ?? null, allLabel, fromLink: false };
});

/**
 * The client's address and browser, for rate limits and the audit trail. The address is
 * the connecting one, recorded by server/peer-address.mjs before Next.js runs; an
 * X-Forwarded-For header counts only when that connection comes from a reverse proxy an
 * administrator has named in Settings (D15). Without the preload (next dev) there is no
 * trustworthy address, so none is used: per-address limits then don't apply, but the
 * per-poster limits still do.
 */
export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const ip = clientAddress(
    {
      peer: h.get(PEER_HEADER) || null,
      forwardedFor: h.get('x-forwarded-for'),
      connectingIp: h.get('cf-connecting-ip'),
    },
    await trustedProxies(db()),
    // The demo link's tunnel connects from this machine (docs/demo-link.md).
    { trustLoopback: demoOrigin() !== null },
  );
  return { ipAddress: ip, userAgent: h.get('user-agent') };
}
