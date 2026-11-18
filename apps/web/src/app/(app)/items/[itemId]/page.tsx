import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import {
  can,
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
  const [kind, history, kits] = await Promise.all([
    getKind(db(), session.actor, item.kind_id),
    itemHistory(db(), session.actor, item.id, 20),
    edit && !item.is_kit && !item.parent_id
      ? listKits(db(), session.actor, item.site_id)
      : Promise.resolve([]),
  ]);
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

      <section className="panel" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
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
            {detail.locationCode
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

      <section className="panel" aria-labelledby="photos-heading">
        <h2 id="photos-heading">Photos</h2>
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
        <section className="panel" aria-labelledby="kit-heading">
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
        <section className="panel" aria-labelledby="kit-heading">
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
        <section className="panel" aria-labelledby="kit-heading">
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

      <section className="panel" aria-labelledby="label-heading">
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

      <section className="panel" aria-labelledby="rules-heading">
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
        <section className="panel" aria-labelledby="retire-heading">
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

      <section className="panel" aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
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
