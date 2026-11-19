import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import {
  History,
  LogIn,
  LogOut,
  MapPin,
  PackageSearch,
  Send,
  Tag,
  TriangleAlert,
} from 'lucide-react';
import {
  can,
  incomingTransferFor,
  itemMovements,
  MOVEMENT_LABELS,
  movementChoices,
  transferDestinations,
  getKind,
  getItem,
  intervalText,
  itemHistory,
  itemLabelCode,
  itemLabelUrl,
  KIND_RULES_NOTICE,
  listKits,
  penceToPounds,
  qrSvg,
  RULE_TYPE_LABELS,
} from '@northkit/core';
import { ActionForm, SelectField } from '@/components/form/action-form';
import { ItemStatusPill } from '@/components/badges';
import { orDash } from '@/components/states';
import { CardHead, Delta, Person } from '@/components/ui/primitives';
import { ukDay, ukMoment } from '@/lib/format';
import { markFoundAction } from '../actions';
import { receiveTransferAction, sendTransferAction } from '../../transfers/actions';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import {
  addPhotosAction,
  deletePhotoAction,
  removeFromKitAction,
  replaceLabelAction,
  retireItemAction,
  setKitAction,
} from '../actions';

export const metadata: Metadata = { title: 'Item' };

const ukDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
});
const day = (v: string | null) => (v ? ukDate.format(new Date(`${v}T00:00:00Z`)) : null);

const ACTION_WORDS: Record<string, string> = {
  create: 'Added',
  update: 'Changed',
  archive: 'Archived',
  restore: 'Restored',
  delete: 'Removed',
};

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const session = await requirePermission('items.view');
  const itemId = routeId((await params).itemId);
  const detail = await orNotFound(getItem(db(), session.actor, itemId));
  const { item } = detail;
  const retired = item.status === 'retired';
  const edit = can(session.actor, 'items.edit') && !retired;
  const approve = can(session.actor, 'items.approve');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const code = await itemLabelCode(db(), session.actor, item.id);
  const url = itemLabelUrl(code, host ? `${proto}://${host}` : undefined);
  const canMove = can(session.actor, 'checkouts.create') && !retired;
  const canSend = can(session.actor, 'checkouts.edit') && !retired;
  const [kind, history, movements, kits, incoming, depots, choices] = await Promise.all([
    getKind(db(), session.actor, item.kind_id),
    itemHistory(db(), session.actor, item.id, 20),
    can(session.actor, 'checkouts.view')
      ? itemMovements(db(), session.actor, item.id, 30)
      : Promise.resolve([]),
    edit && !item.is_kit && !item.parent_id
      ? listKits(db(), session.actor, item.site_id)
      : Promise.resolve([]),
    item.status === 'in_transit'
      ? incomingTransferFor(db(), session.actor, item.id)
      : Promise.resolve(null),
    canSend && item.status === 'available'
      ? transferDestinations(db(), session.actor)
      : Promise.resolve([]),
    canSend && (item.status === 'missing' || item.status === 'in_transit')
      ? movementChoices(db(), session.actor)
      : Promise.resolve(null),
  ]);
  const places = (choices?.places ?? []).filter((x) => x.siteId === item.site_id);
  const now = new Date();
  const cost = item.cost_pence !== null ? `£${penceToPounds(Number(item.cost_pence))}` : null;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/items">Items</Link>
      </p>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">
            {detail.kindName} · {detail.siteCode}
          </p>
          <h1>{item.asset_number}</h1>
          <p>
            <ItemStatusPill status={item.status} />
            {item.ownership === 'hired_in' ? (
              <span className="muted"> · hired in from {item.hire_company}</span>
            ) : null}
          </p>
        </div>
        <div className="row">
          <a className="button" href={`/items/labels?ids=${item.id}&layout=single`}>
            Print label
          </a>
          {edit ? (
            <Link className="button button-primary" href={`/items/${item.id}/edit`}>
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      <section className="card card-hero" aria-labelledby="where-heading">
        <CardHead
          icon={MapPin}
          eyebrow="Where it is now"
          title={
            item.status === 'out' && item.holder_user_id
              ? 'With a person'
              : item.status === 'in_transit'
                ? 'On its way to another depot'
                : item.status === 'missing'
                  ? 'Reported missing'
                  : detail.locationName
                    ? detail.locationName
                    : 'Not placed yet'
          }
          headingId="where-heading"
          meta={
            detail.locationCode && item.status !== 'missing'
              ? `${detail.locationCode} · ${detail.siteCode}`
              : detail.siteCode
          }
        />
        <div className="where-body">
          {item.status === 'out' && detail.holderName ? <Person name={detail.holderName} /> : null}
          {item.status === 'out' && item.checked_out_at ? (
            <p className="muted">Out since {ukMoment(item.checked_out_at, now)}.</p>
          ) : null}
          {item.status === 'out' && item.due_back_on ? (
            <p>
              Due back <strong>{ukDay(item.due_back_on)}</strong>{' '}
              {item.overdue_at && item.overdue_at <= now ? <Delta tone="bad">Overdue</Delta> : null}
            </p>
          ) : null}
          {incoming ? (
            <p>
              Sent from {incoming.fromSiteCode} by {incoming.carrier}, expected{' '}
              <strong>{ukDay(incoming.expectedOn)}</strong>.
            </p>
          ) : null}
          {item.status === 'quarantined' ? (
            <p>
              <TriangleAlert size={16} className="icon" aria-hidden="true" /> Quarantined: it can’t
              be checked out until a passed inspection is recorded.
            </p>
          ) : null}
        </div>
        <div className="card-foot">
          <span className="row">
            {canMove && item.status === 'available' ? (
              <Link className="button button-primary" href={`/move/out?item=${item.id}`}>
                <LogOut size={16} className="icon" aria-hidden="true" />
                Check out
              </Link>
            ) : null}
            {canMove && item.status === 'out' ? (
              <Link className="button button-primary" href={`/move/in?item=${item.id}`}>
                <LogIn size={16} className="icon" aria-hidden="true" />
                Check in
              </Link>
            ) : null}
            {canMove && (item.status === 'available' || item.status === 'out') ? (
              <Link className="button" href={`/move/missing?item=${item.id}`}>
                <PackageSearch size={16} className="icon" aria-hidden="true" />
                Report missing
              </Link>
            ) : null}
          </span>
        </div>
        {item.status === 'missing' && canSend && places.length ? (
          <ActionForm action={markFoundAction.bind(null, item.id)} submitLabel="Record it as found">
            <SelectField
              name="locationId"
              label="Where it was found"
              options={places.map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))}
            />
            <div className="field">
              <label htmlFor="found-note">Note</label>
              <input id="found-note" name="note" className="input" maxLength={1000} />
            </div>
          </ActionForm>
        ) : null}
        {incoming ? (
          <ActionForm
            action={receiveTransferAction.bind(null, incoming.id)}
            submitLabel="Receive it here"
          >
            <SelectField
              name="locationId"
              label="Put it in"
              options={(choices?.places ?? [])
                .filter((x) => x.siteId === incoming.toSiteId)
                .map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))}
            />
            <div className="field">
              <label htmlFor="recv-note">Note</label>
              <input id="recv-note" name="note" className="input" maxLength={1000} />
            </div>
          </ActionForm>
        ) : null}
      </section>

      {canSend && item.status === 'available' && depots.some((d) => d.id !== item.site_id) ? (
        <section className="card" aria-labelledby="send-heading">
          <CardHead
            icon={Send}
            headingId="send-heading"
            title="Send to another depot"
            meta="It is in transit until the other depot receives it. Nobody can check it out meanwhile."
          />
          <ActionForm action={sendTransferAction.bind(null, item.id)} submitLabel="Send it">
            <SelectField
              name="toSiteId"
              label="Depot"
              options={depots
                .filter((d) => d.id !== item.site_id)
                .map((d) => ({ value: d.id, label: `${d.code} · ${d.name}` }))}
            />
            <div className="field">
              <label htmlFor="carrier">Who or what is carrying it</label>
              <input
                id="carrier"
                name="carrier"
                className="input"
                required
                maxLength={200}
                placeholder="Depot van 3, a courier, Sam Hart"
              />
            </div>
            <div className="field">
              <label htmlFor="expectedOn">Expected on</label>
              <input id="expectedOn" name="expectedOn" type="date" className="input" required />
            </div>
            <div className="field">
              <label htmlFor="send-note">Note</label>
              <input id="send-note" name="note" className="input" maxLength={1000} />
            </div>
          </ActionForm>
        </section>
      ) : null}

      <section className="card" aria-labelledby="details-heading">
        <CardHead icon={Tag} headingId="details-heading" title="Details" />
        <dl className="details">
          <dt>Kind</dt>
          <dd>
            <Link href={`/kinds/${item.kind_id}`}>{detail.kindName}</Link>
            {!detail.kindActive ? ' (deactivated)' : ''}
          </dd>
          <dt>Description</dt>
          <dd>{orDash(item.description)}</dd>
          <dt>Make and model</dt>
          <dd>{orDash([item.make, item.model].filter(Boolean).join(' '))}</dd>
          <dt>Serial number</dt>
          <dd>{orDash(item.serial_number)}</dd>
          <dt>Home depot</dt>
          <dd>
            {detail.siteCode} · {detail.siteName}
          </dd>
          <dt>Where it is now</dt>
          <dd>
            {detail.holderName
              ? detail.holderName
              : detail.locationCode
                ? `${detail.locationCode} · ${detail.locationName}`
                : 'Not placed yet'}
          </dd>
          <dt>Purchased</dt>
          <dd>{orDash(day(item.purchase_date))}</dd>
          <dt>Cost</dt>
          <dd>{orDash(cost)}</dd>
          {item.ownership === 'hired_in' ? (
            <>
              <dt>Hire company</dt>
              <dd>{orDash(item.hire_company)}</dd>
              <dt>Hire reference</dt>
              <dd>{orDash(item.hire_reference)}</dd>
              <dt>Off-hire date</dt>
              <dd>{orDash(day(item.off_hire_date))}</dd>
            </>
          ) : null}
          {retired ? (
            <>
              <dt>Retired</dt>
              <dd>
                {item.retired_at ? ukDateTime.format(item.retired_at) : ''}: {item.retired_reason}
              </dd>
            </>
          ) : null}
          <dt>Notes</dt>
          <dd>{orDash(item.notes)}</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="photos-heading">
        <CardHead headingId="photos-heading" eyebrow="Photos" title="Photos of the item" />
        {detail.photos.length === 0 ? (
          <p className="muted">No photos yet.</p>
        ) : (
          <ul className="photo-grid">
            {detail.photos.map((p, i) => (
              <li key={p.id}>
                <a href={`/item-photos/${p.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/item-photos/${p.id}?v=thumb`}
                    alt={`Photo ${i + 1} of ${item.asset_number}`}
                    width={p.width}
                    height={p.height}
                    loading="lazy"
                  />
                </a>
                {edit ? (
                  <ActionForm
                    action={deletePhotoAction.bind(null, item.id, p.id)}
                    submitLabel={`Remove photo ${i + 1}`}
                    submitClassName="button button-link"
                    className="inline"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {edit && detail.photos.length < 10 ? (
          <ActionForm
            action={addPhotosAction.bind(null, item.id)}
            submitLabel="Add photos"
            pendingLabel="Uploading…"
          >
            <div className="field">
              <label htmlFor="photos">Take or choose photos</label>
              <input
                id="photos"
                name="photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
              />
              <p className="hint">
                JPEG, PNG or WebP, up to 10 MB each, {10 - detail.photos.length} more allowed. Where
                and when a photo was taken is removed before it is stored.
              </p>
            </div>
          </ActionForm>
        ) : null}
      </section>

      {item.is_kit ? (
        <section className="card" aria-labelledby="kit-heading">
          <h2 id="kit-heading">In this kit</h2>
          {detail.parts.length === 0 ? (
            <p className="muted">
              Nothing in this kit yet. Open an item at the same depot and choose this kit.
            </p>
          ) : (
            <ul className="plain stack">
              {detail.parts.map((p) => (
                <li key={p.id} className="row">
                  <span>
                    <Link href={`/items/${p.id}`}>{p.assetNumber}</Link> · {p.kindName}{' '}
                    <ItemStatusPill status={p.status} />
                  </span>
                  {edit ? (
                    <ActionForm
                      action={removeFromKitAction.bind(null, item.id, p.id)}
                      submitLabel={`Take ${p.assetNumber} out`}
                      submitClassName="button button-link"
                      className="inline"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : detail.kit ? (
        <section className="card" aria-labelledby="kit-heading">
          <h2 id="kit-heading">Part of a kit</h2>
          <p>
            In <Link href={`/items/${detail.kit.id}`}>{detail.kit.assetNumber}</Link> (
            {detail.kit.kindName}).
          </p>
          {edit ? (
            <ActionForm
              action={removeFromKitAction.bind(null, detail.kit.id, item.id)}
              submitLabel="Take it out of the kit"
              submitClassName="button"
            />
          ) : null}
        </section>
      ) : edit && kits.length > 0 ? (
        <section className="card" aria-labelledby="kit-heading">
          <h2 id="kit-heading">Put in a kit</h2>
          <ActionForm action={setKitAction.bind(null, item.id)} submitLabel="Put in this kit">
            <SelectField
              name="kitId"
              label="Kit at this depot"
              options={kits.map((k) => ({
                value: k.id,
                label: `${k.assetNumber} · ${k.kindName}`,
              }))}
            />
          </ActionForm>
        </section>
      ) : null}

      <section className="card" aria-labelledby="label-heading">
        <h2 id="label-heading">Label</h2>
        <div className="row">
          <div
            className="label-preview"
            role="img"
            aria-label={`QR code for ${item.asset_number}`}
            dangerouslySetInnerHTML={{
              __html: qrSvg(url, { title: `QR code for ${item.asset_number}` }),
            }}
          />
          <div className="stack">
            <p className="muted">
              Scanning it opens this page for someone signed in. Anyone else sees only the kind and
              asset number.
            </p>
            <p>
              <a className="button" href={`/items/labels?ids=${item.id}&layout=single`}>
                Print one label (100 × 50 mm)
              </a>{' '}
              <a className="button" href={`/items/labels?ids=${item.id}&layout=a4-21`}>
                On an A4 sheet
              </a>
            </p>
          </div>
        </div>
        {edit ? (
          <ActionForm
            action={replaceLabelAction.bind(null, item.id)}
            submitLabel="Replace the label"
            submitClassName="button button-danger"
          >
            <p className="muted small">
              Use this if a label was lost, copied or damaged: every printed copy of the old one
              stops working.
            </p>
          </ActionForm>
        ) : null}
      </section>

      <section className="card" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Inspection rules for this kind</h2>
        {kind.rules.length === 0 ? (
          <p className="muted">This kind has no rules yet.</p>
        ) : (
          <ul className="plain stack">
            {kind.rules.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong> ({RULE_TYPE_LABELS[r.rule_type]}): every{' '}
                {intervalText(r.interval_value, r.interval_unit)}
                {r.required ? ' · required' : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          {KIND_RULES_NOTICE} Schedules and records arrive in a later release.
        </p>
      </section>

      {approve && item.status === 'available' ? (
        <section className="card" aria-labelledby="retire-heading">
          <h2 id="retire-heading">Retire this item</h2>
          <p className="muted">
            A retired item stays in the register with its history but can’t be changed or issued.
            Nothing is deleted.
          </p>
          <ActionForm
            action={retireItemAction.bind(null, item.id, item.row_version)}
            submitLabel="Retire item"
            submitClassName="button button-danger"
          >
            <div className="field">
              <label htmlFor="reason">Why is it being retired?</label>
              <input id="reason" name="reason" className="input" required maxLength={500} />
            </div>
          </ActionForm>
        </section>
      ) : null}

      {movements.length ? (
        <section className="card" aria-labelledby="moves-heading">
          <CardHead
            icon={History}
            headingId="moves-heading"
            title="Where it has been"
            meta="Every check-out, check-in, move, missing report and transfer, newest first. Nothing here is ever edited."
          />
          <ol className="timeline">
            {movements.map((m) => (
              <li key={m.id}>
                <span className="timeline-when">{ukMoment(m.occurredAt, now)}</span>
                <span className="timeline-what">
                  <strong>{MOVEMENT_LABELS[m.type]}</strong>
                  {m.fromLabel || m.toLabel ? (
                    <>
                      {' '}
                      {m.fromLabel ? <>from {m.fromLabel} </> : null}
                      {m.toLabel ? <>to {m.toLabel}</> : null}
                    </>
                  ) : null}
                  {m.dueBackOn ? <>, due back {ukDay(m.dueBackOn)}</> : null}
                  {m.viaKit ? <>, with kit {m.viaKit}</> : null}
                  {m.byName ? <> · by {m.byName}</> : null}
                  {m.offline ? <> · made offline, recorded {ukMoment(m.recordedAt, now)}</> : null}
                  {m.note ? <span className="timeline-note">“{m.note}”</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="card" aria-labelledby="history-heading">
        <CardHead headingId="history-heading" eyebrow="Record" title="Changes to the record" />
        {history.length === 0 ? (
          <p className="muted">Nothing recorded.</p>
        ) : (
          <ul className="plain stack">
            {history.map((e) => (
              <li key={e.id}>
                {ukDateTime.format(e.created_at)}:{' '}
                {ACTION_WORDS[e.action.split('.').pop() ?? ''] ?? e.action}
                {e.entity_type === 'register.item_photos' ? ' a photo' : ''}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          The full trail, with who and what changed, is in the audit log.
        </p>
      </section>
    </>
  );
}
