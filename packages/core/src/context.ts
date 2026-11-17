import type { Scope } from '@northkit/db';
import { ForbiddenError, NotFoundError } from './errors';
import type { Permission } from './auth/permissions';

/**
 * Who is acting, built server-side from the session (never from the request).
 * siteIds comes from core.accessible_site_ids() and becomes app.site_ids; it already
 * combines the user's own site assignment with their roles' site scopes.
 */
export interface ActorContext {
  userId: string;
  siteIds: readonly string[];
  /** Works at every site (estate-wide): may create sites and grant every-site access. */
  allSites: boolean;
  /** Holds the locked Administrator role. */
  administrator: boolean;
  permissions: ReadonlySet<Permission>;
  /**
   * The licence has lapsed (S1-7): every scoped transaction runs READ ONLY, so the
   * database refuses writes whatever the screens do.
   */
  readOnly: boolean;
}

/** The RLS scope for an actor's unit of work. Every service uses this. */
export function scopeOf(actor: ActorContext, extraSiteIds: readonly string[] = []): Scope {
  return {
    siteIds: extraSiteIds.length ? [...actor.siteIds, ...extraSiteIds] : actor.siteIds,
    userId: actor.userId,
    readOnly: actor.readOnly,
  };
}

export function can(actor: ActorContext, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: ActorContext, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export function requirePermission(actor: ActorContext, permission: Permission): void {
  if (!can(actor, permission)) {
    throw new ForbiddenError('You do not have permission to do that.');
  }
}

/** A site outside the actor's scope looks the same as one that doesn't exist. */
export function requireSite(actor: ActorContext, siteId: string): void {
  if (!actor.siteIds.includes(siteId)) {
    throw new NotFoundError('Site not found.');
  }
}

export function hasSite(actor: ActorContext, siteId: string): boolean {
  return actor.siteIds.includes(siteId);
}
