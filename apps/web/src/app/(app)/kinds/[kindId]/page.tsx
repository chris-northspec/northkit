import type { Metadata } from 'next';
import Link from 'next/link';
import {
  can,
  getKind,
  intervalText,
  KIND_RULES_NOTICE,
  RULE_TYPE_LABELS,
  RULE_TYPES,
} from '@northkit/core';
import { ActionForm, CheckField, Field, SelectField } from '@/components/form/action-form';
import { InUsePill, StatusPill } from '@/components/badges';
import { orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { orNotFound, routeId } from '@/lib/server/load';
import { requirePermission } from '@/lib/server/session';
import {
  addRuleAction,
  deleteKindAction,
  removeRuleAction,
  setKindActiveAction,
  updateKindAction,
  updateRuleAction,
} from '../actions';

export const metadata: Metadata = { title: 'Kind' };

const TYPE_OPTIONS = RULE_TYPES.map((t) => ({ value: t, label: RULE_TYPE_LABELS[t] }));
const UNIT_OPTIONS = [
  { value: 'months', label: 'Months' },
  { value: 'days', label: 'Days' },
];

export default async function KindPage({ params }: { params: Promise<{ kindId: string }> }) {
  const session = await requirePermission('items.view');
  const kindId = routeId((await params).kindId);
  const kind = await orNotFound(getKind(db(), session.actor, kindId));
  const edit = can(session.actor, 'items.approve');

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/kinds">Kinds</Link>
      </p>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-head-meta">Kind</p>
          <h1>{kind.name}</h1>
          <p>{kind.active ? <InUsePill /> : <StatusPill label="Deactivated" />}</p>
        </div>
        <Link className="button" href={`/items?kind=${kind.id}`}>
          Items of this kind ({kind.itemCount.toLocaleString('en-GB')})
        </Link>
      </div>

      <section className="panel" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Inspection rules</h2>
        <p className="notice notice-info">{KIND_RULES_NOTICE}</p>
        {kind.rules.length === 0 ? (
          <p className="muted">No rules yet.</p>
        ) : (
          <ul className="plain stack">
            {kind.rules.map((r) => (
              <li key={r.id}>
                {edit ? (
                  <details>
                    <summary>
                      <strong>{r.title}</strong> ({RULE_TYPE_LABELS[r.rule_type]}): every{' '}
                      {intervalText(r.interval_value, r.interval_unit)}
                      {r.required ? ' · required' : ''}
                    </summary>
                    <ActionForm
                      action={updateRuleAction.bind(null, kind.id, r.id, r.row_version)}
                      submitLabel="Save rule"
                    >
                      <div className="form-grid">
                        <SelectField
                          name="ruleType"
                          label="Type"
                          options={TYPE_OPTIONS}
                          defaultValue={r.rule_type}
                        />
                        <Field name="title" label="Name" defaultValue={r.title} />
                        <Field
                          name="intervalValue"
                          label="Every"
                          type="number"
                          min={1}
                          max={1200}
                          defaultValue={r.interval_value}
                        />
                        <SelectField
                          name="intervalUnit"
                          label="Unit"
                          options={UNIT_OPTIONS}
                          defaultValue={r.interval_unit}
                        />
                      </div>
                      <CheckField
                        name="required"
                        label="Required for this kind"
                        defaultChecked={r.required}
                      />
                      <Field
                        name="note"
                        label="Note"
                        defaultValue={r.note ?? ''}
                        maxLength={1000}
                      />
                    </ActionForm>
                    <ActionForm
                      action={removeRuleAction.bind(null, kind.id, r.id)}
                      submitLabel={`Remove “${r.title}”`}
                      submitClassName="button button-danger"
                    />
                  </details>
                ) : (
                  <>
                    <strong>{r.title}</strong> ({RULE_TYPE_LABELS[r.rule_type]}): every{' '}
                    {intervalText(r.interval_value, r.interval_unit)}
                    {r.required ? ' · required' : ''}
                  </>
                )}
                {r.note ? <p className="muted small">{r.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit ? (
        <section className="panel" aria-labelledby="add-rule-heading">
          <h2 id="add-rule-heading">Add a rule</h2>
          <ActionForm
            action={addRuleAction.bind(null, kind.id)}
            submitLabel="Add rule"
            pendingLabel="Adding…"
          >
            <div className="form-grid">
              <SelectField
                name="ruleType"
                label="Type"
                options={TYPE_OPTIONS}
                defaultValue="puwer"
              />
              <Field name="title" label="Name" hint="For example Thorough examination." />
              <Field
                name="intervalValue"
                label="Every"
                type="number"
                min={1}
                max={1200}
                defaultValue={12}
              />
              <SelectField
                name="intervalUnit"
                label="Unit"
                options={UNIT_OPTIONS}
                defaultValue="months"
              />
            </div>
            <CheckField name="required" label="Required for this kind" />
            <Field
              name="note"
              label="Note"
              hint="Why this interval, and who confirms it."
              maxLength={1000}
            />
          </ActionForm>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="details-heading">
        <h2 id="details-heading">Details</h2>
        {edit ? (
          <ActionForm
            action={updateKindAction.bind(null, kind.id, kind.row_version)}
            submitLabel="Save kind"
          >
            <div className="form-grid">
              <Field name="name" label="Name" defaultValue={kind.name} maxLength={100} />
              <Field
                name="assetPrefix"
                label="Asset number prefix"
                defaultValue={kind.asset_prefix ?? ''}
                autoCapitalize="characters"
                maxLength={8}
              />
            </div>
            <Field
              name="description"
              label="What it covers"
              defaultValue={kind.description ?? ''}
              maxLength={1000}
            />
          </ActionForm>
        ) : (
          <dl className="details">
            <dt>What it covers</dt>
            <dd>{orDash(kind.description)}</dd>
            <dt>Asset number prefix</dt>
            <dd>{orDash(kind.asset_prefix)}</dd>
          </dl>
        )}
      </section>

      {edit ? (
        <section className="panel" aria-labelledby="state-heading">
          <h2 id="state-heading">
            {kind.active ? 'Deactivate this kind' : 'Reactivate this kind'}
          </h2>
          <p className="muted">
            {kind.active
              ? 'No new items can be given this kind. Items that have it keep it.'
              : 'New items can be given this kind again.'}
          </p>
          <ActionForm
            action={setKindActiveAction.bind(null, kind.id, kind.row_version, !kind.active)}
            submitLabel={kind.active ? 'Deactivate' : 'Reactivate'}
            submitClassName={kind.active ? 'button button-danger' : 'button'}
          />
          {kind.itemCount === 0 ? (
            <ActionForm
              action={deleteKindAction.bind(null, kind.id)}
              submitLabel="Delete this kind"
              submitClassName="button button-danger"
            >
              <p className="muted small">
                Nothing uses it, so it can be deleted. A kind in use can only be deactivated.
              </p>
            </ActionForm>
          ) : (
            <p className="muted small">
              It is used by {kind.itemCount.toLocaleString('en-GB')} items, so it can only be
              deactivated, never deleted.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
