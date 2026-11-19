import { sql, withScope, type Db, type ItemStatus } from '@northkit/db';
import { signItemCode } from '../barcodes/item-codes';
import { can, requirePermission, scopeOf, type ActorContext } from '../context';
import { getSetting } from './settings';
import type { MovementChoices } from './movements';
import { movementChoices } from './movements';

// What a phone keeps so check-out, check-in, bulk check-out, report missing and stocktake
// scans work with no signal (S3-6, ADR 0004). It is a copy, never the record: the server
// decides every change when it arrives, and refuses (and the phone shows why) any change
// that no longer fits what the register now says. The snapshot holds each item's label code,
// so scanning works offline; the codes are the ones the signed-in person can already print.

/** The most items one snapshot carries; a bigger register is searched online. */
export const SNAPSHOT_ITEM_LIMIT = 20_000;

export interface SnapshotItem {
  id: string;
  /** Asset number. */
  a: string;
  /** Kind name. */
  k: string;
  /** Status when the snapshot was made. */
  s: ItemStatus;
  /** Label code (what the QR holds), so a scan finds the item offline. */
  t: string;
  /** Depot id. */
  d: string;
  /** Days this kind is normally out for. */
  n: number;
  /** A kit, with this many parts. */
  p?: number;
  /** Part of this kit (asset number); a part moves with its kit. */
  o?: string;
}

export interface OfflineSnapshot {
  version: 1;
  generatedAt: string;
  user: { id: string; name: string };
  /** What this person may do, so the phone offers only that. */
  can: { issueToOthers: boolean; found: boolean };
  defaultDaysOut: number;
  timeZones: Record<string, string>;
  items: SnapshotItem[];
  places: MovementChoices['places'];
  people: MovementChoices['people'];
  homeStores: MovementChoices['homeStores'];
  truncated: boolean;
}

export async function offlineSnapshot(
  db: Db,
  actor: ActorContext,
  name: string,
): Promise<OfflineSnapshot> {
  requirePermission(actor, 'checkouts.view');
  const [choices, defaultDaysOut] = await Promise.all([
    movementChoices(db, actor),
    getSetting(db, 'checkout.default_days_out'),
  ]);
  return withScope(db, { ...scopeOf(actor), readOnly: true }, async (tx) => {
    const rows = await tx
      .selectFrom('register.items as i')
      .innerJoin('register.kinds as k', 'k.id', 'i.kind_id')
      .leftJoin('register.items as p', 'p.id', 'i.parent_id')
      .select([
        'i.id',
        'i.asset_number as a',
        'k.name as k',
        'i.status as s',
        'i.label_version as v',
        'i.site_id as d',
        'k.default_days_out as n',
        'i.is_kit as isKit',
        'p.asset_number as o',
        sql<number>`(SELECT count(*) FROM register.items c WHERE c.parent_id = i.id)::int`.as(
          'parts',
        ),
      ])
      .where('i.status', '<>', 'retired')
      .orderBy('i.asset_number')
      .limit(SNAPSHOT_ITEM_LIMIT + 1)
      .execute();
    const zones = await tx.selectFrom('core.sites').select(['id', 'time_zone']).execute();
    const truncated = rows.length > SNAPSHOT_ITEM_LIMIT;
    return {
      version: 1 as const,
      generatedAt: new Date().toISOString(),
      user: { id: actor.userId, name },
      can: { issueToOthers: can(actor, 'checkouts.edit'), found: can(actor, 'checkouts.edit') },
      defaultDaysOut,
      timeZones: Object.fromEntries(zones.map((z) => [z.id, z.time_zone])),
      items: rows.slice(0, SNAPSHOT_ITEM_LIMIT).map((r) => ({
        id: r.id,
        a: r.a,
        k: r.k,
        s: r.s,
        t: signItemCode(r.id, r.v),
        d: r.d,
        n: r.n ?? defaultDaysOut,
        ...(r.isKit ? { p: r.parts } : {}),
        ...(r.o ? { o: r.o } : {}),
      })),
      places: choices.places,
      people: choices.people,
      homeStores: choices.homeStores,
      truncated,
    };
  });
}
