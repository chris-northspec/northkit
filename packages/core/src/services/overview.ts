import { sql, withScope, type Db } from '@northkit/db';
import { can, requirePermission, scopeOf, type ActorContext } from '../context';
import { missingItems, overdueItems, type HeldItem, type MissingItem } from './movements';
import { countableLocations, type CountableLocation } from './stocktakes';
import { listTransfers, type TransferRow } from './transfers';

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

/** Where the kit is, for the stat cards (S3-1, S3-4). Null for a role that can't see check-outs. */
export interface KitFigures {
  items: number;
  out: number;
  /** Items out at the end of each of the last 14 days, oldest first; null when there is no history to draw. */
  outSeries: number[] | null;
  /** Items out now minus items out 7 days ago; null without history. */
  outChange7: number | null;
  overdue: number;
  /** Not overdue yet, but due back within 7 days. */
  dueNext7: number;
  /** Became overdue in the last 7 days and still out. */
  overdueNew7: number;
  missing: number;
  /** Reported missing in the last 7 days. */
  missingNew7: number;
  inTransit: number;
  transitLate: number;
}

export interface Overview {
  kit: KitFigures | null;
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
    /** The oldest overdue returns, most overdue first (up to 5), and how many there are in all. */
    overdue: HeldItem[];
    missing: MissingItem[];
    /** Transfers past their expected date, for both depots. */
    lateTransfers: TransferRow[];
    /** Locations not counted for longer than the recount setting. */
    recount: CountableLocation[];
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
  const kit = can(actor, 'checkouts.view') ? await kitFigures(db, actor, wanted, now) : null;
  const lists = kit
    ? await Promise.all([
        overdueItems(db, actor, { siteIds: wanted, limit: 5, now }),
        missingItems(db, actor, { siteIds: wanted, limit: 5 }),
        listTransfers(db, actor, { now }),
        countableLocations(db, actor, now),
      ])
    : null;
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
      kit,
      depots,
      totals: {
        depots: depots.length,
        locations: depots.reduce((n, d) => n + d.locations, 0),
        vans: depots.reduce((n, d) => n + d.vans, 0),
        people,
      },
      needsAction: {
        emptyDepots: depots.filter((d) => d.locations === 0),
        lockedAccounts,
        overdue: lists?.[0] ?? [],
        missing: lists?.[1] ?? [],
        lateTransfers: (lists?.[2] ?? []).filter(
          (t) => t.overdue && (wanted.includes(t.fromSiteId) || wanted.includes(t.toSiteId)),
        ),
        recount: (lists?.[3] ?? []).filter((l) => l.due && wanted.includes(l.siteId)).slice(0, 5),
      },
    };
  });
}

const DAY = 86_400_000;

/** The figures behind the stat cards, from the register and the movement record. */
async function kitFigures(
  db: Db,
  actor: ActorContext,
  wanted: readonly string[],
  now: Date,
): Promise<KitFigures> {
  const none = ['00000000-0000-0000-0000-000000000000'];
  const sites = wanted.length ? [...wanted] : none;
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const weekAhead = new Date(now.getTime() + 7 * DAY);
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const c = await tx
      .selectFrom('register.items')
      .select([
        sql<number>`count(*) FILTER (WHERE status <> 'retired')::int`.as('items'),
        sql<number>`count(*) FILTER (WHERE status = 'out')::int`.as('out'),
        sql<number>`count(*) FILTER (WHERE status = 'out' AND overdue_at <= ${now})::int`.as(
          'overdue',
        ),
        sql<number>`count(*) FILTER (WHERE status = 'out' AND overdue_at > ${now} AND overdue_at <= ${weekAhead})::int`.as(
          'dueNext7',
        ),
        sql<number>`count(*) FILTER (WHERE status = 'out' AND overdue_at > ${weekAgo} AND overdue_at <= ${now})::int`.as(
          'overdueNew7',
        ),
        sql<number>`count(*) FILTER (WHERE status = 'missing')::int`.as('missing'),
        sql<number>`count(*) FILTER (WHERE status = 'in_transit' AND parent_id IS NULL)::int`.as(
          'inTransit',
        ),
      ])
      .where('site_id', 'in', sites)
      .executeTakeFirstOrThrow();
    // Items out at the end of each day: today's count, less what changed after that day.
    // from_status and to_status on every movement make this exact, not an estimate.
    const moves = await tx
      .selectFrom('movements.movements')
      .select([
        sql<string>`to_char((occurred_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`.as('day'),
        sql<number>`sum((to_status = 'out')::int - (from_status = 'out')::int)::int`.as('delta'),
        sql<number>`count(*) FILTER (WHERE movement_type = 'missing')::int`.as('missed'),
        sql<number>`count(*)::int`.as('n'),
      ])
      .where('site_id', 'in', sites)
      .where('occurred_at', '>=', new Date(now.getTime() - 14 * DAY))
      .groupBy('day')
      .execute();
    const byDay = new Map(moves.map((m) => [m.day, m]));
    const dayKey = (offset: number) =>
      new Date(now.getTime() - offset * DAY).toISOString().slice(0, 10);
    let outSeries: number[] | null = null;
    let outChange7: number | null = null;
    if (moves.some((m) => m.n > 0)) {
      const series: number[] = [];
      for (let ago = 13; ago >= 0; ago -= 1) {
        let after = 0;
        for (let d = ago - 1; d >= 0; d -= 1) after += byDay.get(dayKey(d))?.delta ?? 0;
        series.push(c.out - after);
      }
      outSeries = series;
      outChange7 = c.out - series[6]!;
    }
    let missingNew7 = 0;
    for (let d = 0; d < 7; d += 1) missingNew7 += byDay.get(dayKey(d))?.missed ?? 0;
    const transfers = await tx
      .selectFrom('movements.transfers')
      .select([
        sql<number>`count(*)::int`.as('open'),
        sql<number>`count(*) FILTER (WHERE expected_on < (${now}::timestamptz AT TIME ZONE from_time_zone)::date)::int`.as(
          'late',
        ),
      ])
      .where('status', '=', 'in_transit')
      .where('kit_transfer_id', 'is', null)
      .where((eb) => eb.or([eb('site_id', 'in', sites), eb('to_site_id', 'in', sites)]))
      .executeTakeFirstOrThrow();
    return {
      items: c.items,
      out: c.out,
      outSeries,
      outChange7,
      overdue: c.overdue,
      dueNext7: c.dueNext7,
      overdueNew7: c.overdueNew7,
      missing: c.missing,
      missingNew7,
      inTransit: transfers.open,
      transitLate: transfers.late,
    };
  });
}
