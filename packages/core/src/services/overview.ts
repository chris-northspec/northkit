import { sql, withScope, type Db } from '@northkit/db';
import { can, requirePermission, scopeOf, type ActorContext } from '../context';

// The Overview figures (S1-9). In Sprint 1 the register holds depots, locations and
// people; the figures that matter day to day (items out, overdue returns, inspections
// due, quarantined, missing) arrive with the sprints that make them (2 to 4), and take
// these cards' places. Every figure comes from the database and respects the site scope.

export interface DepotRow {
  siteId: string;
  code: string;
  name: string;
  locations: number;
  vans: number;
  stores: number;
  yards: number;
  jobSites: number;
}

export interface Overview {
  depots: DepotRow[];
  totals: {
    depots: number;
    locations: number;
    vans: number;
    /** Live people; null unless the actor may see users. */
    people: number | null;
  };
  needsAction: {
    /** Depots with no store, van, yard or job site yet. */
    emptyDepots: DepotRow[];
    /** Accounts locked after failed sign-ins; null unless the actor may see users. */
    lockedAccounts: number | null;
  };
}

/** Counts for the sites in `siteIds` (all the actor's sites when null). */
export async function overview(
  db: Db,
  actor: ActorContext,
  siteIds: readonly string[] | null,
  now = new Date(),
): Promise<Overview> {
  requirePermission(actor, 'overview.view');
  const wanted = siteIds ? actor.siteIds.filter((id) => siteIds.includes(id)) : actor.siteIds;
  return withScope(db, scopeOf(actor), async (tx) => {
    const rows = wanted.length
      ? await tx
          .selectFrom('core.sites as s')
          .leftJoin('core.locations as l', (join) =>
            join.onRef('l.site_id', '=', 's.id').on('l.archived_at', 'is', null),
          )
          .select([
            's.id as siteId',
            's.code',
            's.name',
            sql<number>`count(l.id)::int`.as('locations'),
            sql<number>`count(l.id) FILTER (WHERE l.kind = 'van')::int`.as('vans'),
            sql<number>`count(l.id) FILTER (WHERE l.kind = 'store')::int`.as('stores'),
            sql<number>`count(l.id) FILTER (WHERE l.kind = 'yard')::int`.as('yards'),
            sql<number>`count(l.id) FILTER (WHERE l.kind = 'site')::int`.as('jobSites'),
          ])
          .where('s.id', 'in', wanted)
          .where('s.archived_at', 'is', null)
          .groupBy(['s.id', 's.code', 's.name'])
          .orderBy('s.code')
          .execute()
      : [];
    const depots: DepotRow[] = rows;
    let people: number | null = null;
    let lockedAccounts: number | null = null;
    if (can(actor, 'users.view')) {
      const counts = await tx
        .selectFrom('core.users')
        .select([
          sql<number>`count(*)::int`.as('people'),
          sql<number>`count(*) FILTER (WHERE locked_until > ${now})::int`.as('locked'),
        ])
        .where('archived_at', 'is', null)
        .executeTakeFirstOrThrow();
      people = counts.people;
      lockedAccounts = counts.locked;
    }
    return {
      depots,
      totals: {
        depots: depots.length,
        locations: depots.reduce((n, d) => n + d.locations, 0),
        vans: depots.reduce((n, d) => n + d.vans, 0),
        people,
      },
      needsAction: { emptyDepots: depots.filter((d) => d.locations === 0), lockedAccounts },
    };
  });
}
