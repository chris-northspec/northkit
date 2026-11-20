import { createDb, type Db } from '@northkit/db';
import type pg from 'pg';
import { loadActor } from '../auth/sessions';
import type { ActorContext } from '../context';
import { checkIn, checkOut, reportMissing } from '../services/movements';
import {
  closeStocktake,
  scanStocktake,
  startStocktake,
  stocktakeResult,
} from '../services/stocktakes';
import { sendTransfer } from '../services/transfers';
import { DEMO_SITES, random, type DemoItem } from './demo-company';

// Three months of fictional movement history for the demo company (S3-7): check-outs and
// check-ins, 12 items overdue now, 3 missing, 2 transfers in transit (one late) and one
// stocktake of each depot's main store, with differences. It goes through the same services
// the screens use, so every rule the database enforces applies to the demo too, and a
// movement made 80 days ago is recorded as it would have been (occurred_at in the past).
// The plan comes from a fixed seed and times are counted from the start of today, so a
// second run makes the same history.

const DAY = 86_400_000;

export interface DemoHistoryResult {
  movements: number;
  overdue: number;
  missing: number;
  inTransit: number;
  stocktakes: number;
}

interface Ctx {
  pool: pg.Pool;
  items: readonly DemoItem[];
  itemIds: ReadonlyMap<string, string>;
  /** Items the seed put in a van, to be checked out to it. */
  vanItems: ReadonlyMap<string, string>;
  now?: Date;
}

interface Planned {
  at: number;
  run: () => Promise<unknown>;
}

export async function seedDemoHistory(ctx: Ctx): Promise<DemoHistoryResult> {
  const db: Db = createDb(ctx.pool);
  const rnd = random(20261119);
  const now = ctx.now ?? new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Never later than a minute ago: just after midnight, "today at 07:00" would be in the future.
  const at = (daysAgo: number, hour: number) =>
    new Date(Math.min(midnight - daysAgo * DAY + hour * 3_600_000, now.getTime() - 60_000));

  // People and places by code, and an actor for each person who does things.
  const users = new Map<string, { id: string; name: string }>();
  for (const r of (
    await ctx.pool.query<{ id: string; email: string; display_name: string }>(
      'SELECT id, email, display_name FROM core.users',
    )
  ).rows)
    users.set(r.email, { id: r.id, name: r.display_name });
  const places = new Map<string, { id: string; siteId: string; kind: string }>();
  for (const r of (
    await ctx.pool.query<{ id: string; code: string; site_id: string; kind: string }>(
      'SELECT id, code, site_id, kind FROM core.locations',
    )
  ).rows)
    places.set(r.code, { id: r.id, siteId: r.site_id, kind: r.kind });
  const actors = new Map<string, ActorContext>();
  const actorFor = async (email: string): Promise<ActorContext> => {
    let a = actors.get(email);
    if (!a) {
      const u = users.get(email)!;
      a = await db.transaction().execute((tx) => loadActor(tx, u.id, { allSites: true }));
      actors.set(email, a);
    }
    return a;
  };
  const manager = await actorFor('demo.kitmanager@northkit.test');
  const supervisors: Record<string, string> = {
    ASH: 'demo.supervisor.ash@northkit.test',
    BRK: 'demo.supervisor.brk@northkit.test',
  };
  const supervisorFor = (site: string) => supervisors[site] ?? 'demo.kitmanager@northkit.test';

  // Who carries kit out at each depot.
  const crew: Record<string, string[]> = {
    ASH: [
      'demo.operative1@northkit.test',
      'demo.operative2@northkit.test',
      'demo.supervisor.ash@northkit.test',
    ],
    BRK: ['demo.operative3@northkit.test', 'demo.supervisor.brk@northkit.test'],
    CLY: ['demo.operative4@northkit.test'],
  };
  const jobSites: Record<string, string> = { ASH: 'ASH-JOB-MILL', BRK: 'BRK-JOB-SCHOOL' };

  const plan: Planned[] = [];
  const state = new Map<string, number>(); // tag -> time it is next free (ms); Infinity = out for good
  let movements = 0;
  const add = (time: Date, run: () => Promise<unknown>) => plan.push({ at: time.getTime(), run });
  const loose = (i: DemoItem) => !i.kitTag && !i.retiredReason;

  // 1. Van stock: what the seed put in a van went there early on.
  let vanN = 0;
  for (const [tag, vanCode] of ctx.vanItems) {
    // About half of what the seed put in a van is loaded into it; the rest stays on the shelf.
    if (vanN++ % 2 === 1) continue;
    const when = at(88 - (vanN % 25), 7);
    state.set(tag, when.getTime());
    add(when, () =>
      checkOut(db, manager, {
        itemId: ctx.itemIds.get(tag)!,
        destination: { kind: 'site', locationId: places.get(vanCode)!.id },
        occurredAt: when.toISOString(),
        note: 'Loaded into the van',
      }),
    );
    movements += 1;
  }

  // 2. Ordinary check-outs and check-ins over the last 85 days.
  const free = (i: DemoItem, t: number) => (state.get(i.tag) ?? 0) <= t;
  const available = DEMO_SITES.map((s) => ({
    site: s.code,
    items: ctx.items.filter((i) => i.siteCode === s.code && loose(i) && !ctx.vanItems.has(i.tag)),
  }));
  const person = (site: string) => {
    const list = crew[site]!;
    return list[Math.floor(rnd() * list.length)]!;
  };
  const cycle = (
    site: string,
    i: DemoItem,
    out: Date,
    backAfterDays: number | null,
    dueDays: number,
  ) => {
    const who = person(site);
    const toJob = jobSites[site] && rnd() < 0.3;
    const due = new Date(out.getTime() + dueDays * DAY).toISOString().slice(0, 10);
    add(out, () =>
      checkOut(db, manager, {
        itemId: ctx.itemIds.get(i.tag)!,
        destination: toJob
          ? { kind: 'site', locationId: places.get(jobSites[site]!)!.id }
          : { kind: 'person', userId: users.get(who)!.id },
        dueBackOn: due,
        occurredAt: out.toISOString(),
      }),
    );
    movements += 1;
    if (backAfterDays === null) {
      state.set(i.tag, Infinity);
      return;
    }
    const back = new Date(out.getTime() + backAfterDays * DAY + 3 * 3_600_000);
    state.set(i.tag, back.getTime());
    if (back.getTime() > now.getTime() - 3_600_000) {
      // Not back yet: it is still out today, not overdue unless its date has passed.
      state.set(i.tag, Infinity);
      return;
    }
    const actor = supervisorFor(site);
    add(back, async () =>
      checkIn(db, await actorFor(actor), {
        itemId: ctx.itemIds.get(i.tag)!,
        locationId: places.get(`${site}-STORE`)!.id,
        note: rnd() < 0.15 ? 'Cable a little worn' : null,
        occurredAt: back.toISOString(),
      }),
    );
    movements += 1;
  };

  for (const { site, items } of available) {
    for (let n = 0; n < 130; n++) {
      const daysAgo = 85 - Math.floor((n / 130) * 84) - Math.floor(rnd() * 3);
      const out = at(Math.max(daysAgo, 1), 7 + Math.floor(rnd() * 5));
      const item = items[Math.floor(rnd() * items.length)]!;
      if (!free(item, out.getTime()) || item.kind === 'plant') continue;
      const days = 1 + Math.floor(rnd() * 9);
      cycle(site, item, out, days, days + Math.floor(rnd() * 3));
    }
  }

  // 3. Twelve items overdue now: out 10 to 40 days ago, due a few days after, never back.
  let overdue = 0;
  const candidates = available.flatMap(({ site, items }) =>
    items.filter((i) => i.kind !== 'plant').map((item) => ({ site, item })),
  );
  // Take every 37th candidate, so the twelve are spread over the depots and kinds.
  for (let n = 5; overdue < 12 && n < candidates.length; n += 11) {
    const { site, item } = candidates[n]!;
    const out = at(10 + (overdue % 4) * 8 + Math.floor(rnd() * 5), 8);
    if ((state.get(item.tag) ?? 0) > out.getTime()) continue;
    cycle(site, item, out, null, 3 + Math.floor(rnd() * 4));
    overdue += 1;
  }
  // 4. A few out now and not yet due.
  let current = 0;
  for (let n = 17; current < 18 && n < candidates.length; n += 13) {
    const { site, item } = candidates[n]!;
    const out = at(1 + Math.floor(rnd() * 3), 8);
    if ((state.get(item.tag) ?? 0) > out.getTime()) continue;
    cycle(site, item, out, null, 5 + Math.floor(rnd() * 8));
    current += 1;
  }

  // 5. Two reported missing here, and the Ashgrove stocktake marks a third: three in all.
  const missingTags: string[] = [];
  for (const { site, items } of available) {
    const item = items.find(
      (i) =>
        (state.get(i.tag) ?? 0) === 0 &&
        i.kind !== 'plant' &&
        !i.isKit &&
        !missingTags.includes(i.tag),
    );
    if (!item || missingTags.length >= 2) continue;
    const which = missingTags.length;
    const when = at([11, 3][which]!, 15);
    missingTags.push(item.tag);
    state.set(item.tag, Infinity);
    const reporter = supervisorFor(site);
    add(when, async () =>
      reportMissing(db, await actorFor(reporter), {
        itemId: ctx.itemIds.get(item.tag)!,
        note: [
          'Not in the van after the Mill Lane job',
          'Missing from the cage at the end of the week',
          'Not returned by the hire customer',
        ][which]!,
        occurredAt: when.toISOString(),
      }),
    );
    movements += 1;
  }

  // 6. Two transfers in transit: one on its way, one late.
  const sendable = (site: string) =>
    ctx.items.find(
      (i) =>
        i.siteCode === site &&
        loose(i) &&
        !ctx.vanItems.has(i.tag) &&
        (state.get(i.tag) ?? 0) === 0 &&
        !i.isKit &&
        i.kind !== 'plant',
    );
  const transfers: [string, string, number, number, string][] = [
    ['ASH', 'BRK', 1, 2, 'Depot van 2'],
    ['CLY', 'ASH', 6, -2, 'Courier'],
  ];
  const siteIds = new Map(
    (
      await ctx.pool.query<{ id: string; code: string }>('SELECT id, code FROM core.sites')
    ).rows.map((r) => [r.code, r.id]),
  );
  let inTransit = 0;
  for (const [from, to, sentAgo, expectedIn, carrier] of transfers) {
    const item = sendable(from);
    if (!item) continue;
    state.set(item.tag, Infinity);
    const sent = at(sentAgo, 13);
    const expected = new Date(midnight + expectedIn * DAY).toISOString().slice(0, 10);
    add(sent, () =>
      sendTransfer(db, manager, {
        itemId: ctx.itemIds.get(item.tag)!,
        toSiteId: siteIds.get(to)!,
        carrier,
        expectedOn: expected,
        note: 'Needed on the other depot’s next job',
        occurredAt: sent.toISOString(),
      }),
    );
    movements += 1;
    inTransit += 1;
  }

  // Run it all in time order.
  plan.sort((a, b) => a.at - b.at);
  for (const step of plan) await step.run();

  // 7. One stocktake of each depot's main store, with differences.
  let stocktakes = 0;
  for (const site of DEMO_SITES) {
    const actor = await actorFor(supervisorFor(site.code));
    const store = places.get(`${site.code}-STORE`)!;
    const st = await startStocktake(db, actor, {
      locationId: store.id,
      occurredAt: at(0, 7).toISOString(),
    });
    const inStore = (
      await ctx.pool.query<{ id: string; asset_number: string }>(
        `SELECT id, asset_number FROM register.items WHERE location_id = $1 AND status IN ('available', 'out') AND parent_id IS NULL AND NOT is_kit ORDER BY asset_number`,
        [store.id],
      )
    ).rows;
    // Two expected items are not found; one item from the cage and one from a van turn up.
    const skipped = new Set([inStore[3]?.id, inStore[11]?.id]);
    for (const row of inStore)
      if (!skipped.has(row.id))
        await scanStocktake(db, actor, { stocktakeId: st.id, itemId: row.id });
    const strays = (
      await ctx.pool.query<{ id: string }>(
        `SELECT i.id FROM register.items i JOIN core.locations l ON l.id = i.location_id
        WHERE l.code = $1 AND i.status = 'available' AND i.parent_id IS NULL ORDER BY i.asset_number LIMIT 2`,
        [`${site.code}-CAGE`],
      )
    ).rows;
    for (const s of strays) await scanStocktake(db, actor, { stocktakeId: st.id, itemId: s.id });
    const result = await stocktakeResult(db, actor, st.id);
    const decisions: Record<
      string,
      { decision: 'missing' | 'ignored' | 'moved_here' | 'note_only'; reason?: string }
    > = {};
    result.notFound.forEach((l, n) => {
      decisions[l.itemId] =
        n === 0 && site.code === 'ASH'
          ? { decision: 'missing' }
          : { decision: 'ignored', reason: 'On loan to a customer, paperwork to follow' };
    });
    result.unexpected.forEach((l, n) => {
      decisions[l.itemId] =
        n === 0 && l.canMove ? { decision: 'moved_here' } : { decision: 'note_only' };
    });
    await closeStocktake(db, actor, { stocktakeId: st.id, note: 'Quarterly count', decisions });
    stocktakes += 1;
  }

  return { movements, overdue, missing: missingTags.length, inTransit, stocktakes };
}
