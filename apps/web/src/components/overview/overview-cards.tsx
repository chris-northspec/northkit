import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Overview } from '@northkit/core';
import { Illustration } from '@/components/illustration';
import { Delta, Eyebrow, StatCard } from '@/components/ui/primitives';
import { daysBetween, n, plural, relativeDays, ukDay, ukMoment } from '@/lib/format';

// The Overview's stat cards and Needs action panel (S3-1, standard 13): four stat cards
// built to the standard's anatomy (eyebrow, figure and unit, a sparkline from real history
// where there is any, a delta chip in words, a footer link), and a panel where each item
// has a severity edge, a headline saying what to do and one line of context. The first card
// is the screen's one hero card.

export function Kpis({ o }: { o: Overview }) {
  const k = o.kit;
  if (!k) {
    return (
      <>
        <h2 className="visually-hidden">At a glance</h2>
        <ul className="stats">
          <StatCard
            href="/sites"
            label="Depots"
            value={o.totals.depots}
            unit={plural(o.totals.locations, 'location')}
            hero
            delta={<Delta>Stores, vans and yards</Delta>}
            footer="See depots"
          />
          <StatCard
            href="/sites"
            label="Vans"
            value={o.totals.vans}
            unit="to check kit out to"
            delta={<Delta>Set up by depot</Delta>}
            footer="See locations"
          />
        </ul>
      </>
    );
  }
  const change = k.outChange7;
  return (
    <>
      <h2 className="visually-hidden">At a glance</h2>
      <ul className="stats">
        <StatCard
          href="/items?status=out"
          label="Items out"
          value={k.out}
          unit={`of ${n(k.items)} ${k.items === 1 ? 'item' : 'items'}`}
          hero
          spark={k.outSeries ?? undefined}
          sparkLabel={
            k.outSeries
              ? `Items out at the end of each of the last 14 days: ${k.outSeries[0]} then, ${k.out} now.`
              : undefined
          }
          delta={
            change === null ? (
              <Delta>No movements in 14 days</Delta>
            ) : change === 0 ? (
              <Delta>Same as 7 days ago</Delta>
            ) : (
              <Delta direction={change > 0 ? 'up' : 'down'}>
                {plural(Math.abs(change), 'item')} {change > 0 ? 'more' : 'fewer'} than 7 days ago
              </Delta>
            )
          }
          footer="See items out"
        />
        <StatCard
          href="/who-has-what?overdue=1"
          label="Overdue returns"
          value={k.overdue}
          unit={k.overdue === 1 ? 'item past its date' : 'items past their date'}
          tone={k.overdue > 0 ? 'danger' : undefined}
          delta={
            k.overdue > 0 ? (
              <Delta tone="bad" direction={k.overdueNew7 > 0 ? 'up' : undefined}>
                {k.overdueNew7 > 0 ? `${n(k.overdueNew7)} new this week` : 'None new this week'}
              </Delta>
            ) : (
              <Delta tone="good">
                {k.dueNext7 > 0 ? `${n(k.dueNext7)} due back this week` : 'All back on time'}
              </Delta>
            )
          }
          footer="Chase returns"
        />
        <StatCard
          href="/items?status=missing"
          label="Missing"
          value={k.missing}
          unit={k.missing === 1 ? 'item reported' : 'items reported'}
          tone={k.missing > 0 ? 'danger' : undefined}
          delta={
            k.missingNew7 > 0 ? (
              <Delta tone="bad" direction="up">
                {n(k.missingNew7)} reported this week
              </Delta>
            ) : (
              <Delta tone="good">None reported this week</Delta>
            )
          }
          footer="See missing kit"
        />
        <StatCard
          href="/transfers"
          label="In transit"
          value={k.inTransit}
          unit={k.inTransit === 1 ? 'transfer between depots' : 'transfers between depots'}
          tone={k.transitLate > 0 ? 'warning' : undefined}
          delta={
            k.transitLate > 0 ? (
              <Delta tone="attention">{n(k.transitLate)} not received by the date</Delta>
            ) : (
              <Delta tone="good">{k.inTransit ? 'None late' : 'Nothing on the road'}</Delta>
            )
          }
          footer="See transfers"
        />
      </ul>
    </>
  );
}

type Severity = 'danger' | 'warning';

function Action({
  href,
  severity,
  headline,
  context,
}: {
  href: string;
  severity: Severity;
  headline: ReactNode;
  context: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className={`action-card edge-${severity}`}>
        <span className="action-headline">{headline}</span>
        <span className="action-context">{context}</span>
      </Link>
    </li>
  );
}

/** What needs doing now: the narrow panel beside the table. */
export function NeedsAction({ o, now }: { o: Overview; now: Date }) {
  const a = o.needsAction;
  const locked = a.lockedAccounts ?? 0;
  const count =
    a.overdue.length +
    a.missing.length +
    a.lateTransfers.length +
    a.recount.length +
    a.emptyDepots.length +
    locked;
  const overdueTotal = o.kit?.overdue ?? 0;
  const missingTotal = o.kit?.missing ?? 0;
  return (
    <section className="needs-action" aria-labelledby="needs-action-heading">
      <div className="card-head card-head-flush">
        <div className="card-head-text">
          <Eyebrow tone={count ? 'danger' : undefined}>Needs action</Eyebrow>
          <h2 id="needs-action-heading" className="card-title">
            {count ? `${plural(count, 'thing')} to do` : 'All clear'}
          </h2>
        </div>
      </div>
      {count === 0 ? (
        <div className="all-clear" role="status">
          <Illustration name="all-clear" width={160} height={110} />
          <p>
            <strong>Nothing needs action.</strong>
          </p>
          <p className="muted">
            Nothing is overdue, missing or late, every location has been counted lately, and nobody
            is locked out.
          </p>
        </div>
      ) : (
        <ul className="needs-action-list">
          {a.overdue.map((i) => {
            const late = i.dueBackOn ? daysBetween(new Date(`${i.dueBackOn}T12:00:00Z`), now) : 0;
            return (
              <Action
                key={i.id}
                href={`/items/${i.id}`}
                severity="danger"
                headline={`Chase ${i.assetNumber}`}
                context={`${i.holderName ?? i.placeName ?? 'Unknown'} · due ${ukDay(i.dueBackOn)}${late > 0 ? `, ${plural(late, 'day')} overdue` : ''}`}
              />
            );
          })}
          {overdueTotal > a.overdue.length ? (
            <li>
              <Link href="/who-has-what?overdue=1" className="action-card">
                <span className="action-headline">
                  {plural(overdueTotal - a.overdue.length, 'more overdue return')}
                </span>
                <span className="action-context">See every overdue return</span>
              </Link>
            </li>
          ) : null}
          {a.missing.map((m) => (
            <Action
              key={m.id}
              href={`/items/${m.id}`}
              severity="danger"
              headline={`Find ${m.assetNumber}`}
              context={`Reported missing ${m.reportedAt ? relativeDays(m.reportedAt, now) : ''}${m.reportedBy ? ` by ${m.reportedBy}` : ''}${m.lastSeen ? ` · last with ${m.lastSeen}` : ''}`}
            />
          ))}
          {missingTotal > a.missing.length ? (
            <li>
              <Link href="/items?status=missing" className="action-card">
                <span className="action-headline">
                  {plural(missingTotal - a.missing.length, 'more missing item')}
                </span>
                <span className="action-context">See every missing item</span>
              </Link>
            </li>
          ) : null}
          {a.lateTransfers.map((t) => (
            <Action
              key={t.id}
              href="/transfers"
              severity="warning"
              headline={`${t.assetNumber} hasn’t reached ${t.toSiteCode}`}
              context={`Sent from ${t.fromSiteCode} by ${t.carrier} · expected ${ukDay(t.expectedOn)}`}
            />
          ))}
          {a.recount.map((l) => (
            <Action
              key={l.id}
              href="/stocktake"
              severity="warning"
              headline={`Count ${l.name}`}
              context={`${l.siteCode} · ${l.lastCountedAt ? `last counted ${ukMoment(l.lastCountedAt, now)}` : 'never counted'}`}
            />
          ))}
          {a.emptyDepots.map((d) => (
            <Action
              key={d.siteId}
              href={`/sites/${d.siteId}/locations`}
              severity="warning"
              headline={`Set up ${d.code} · ${d.name}`}
              context="It has no stores, vans or yards yet"
            />
          ))}
          {locked ? (
            <Action
              href="/users"
              severity="warning"
              headline={`${plural(locked, 'account')} locked`}
              context="Locked after failed sign-ins"
            />
          ) : null}
        </ul>
      )}
    </section>
  );
}
