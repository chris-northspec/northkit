import type { Metadata } from 'next';
import Link from 'next/link';
import {
  can,
  getOrganisation,
  PRODUCT_VERSION,
  listSettings,
  trustedProxies,
} from '@northkit/core';
import { ukDate } from '@northkit/licence';
import { ActionForm, Field, SelectField } from '@/components/form/action-form';
import { orDash } from '@/components/states';
import { db } from '@/lib/server/db';
import { requirePermission } from '@/lib/server/session';
import { timeZoneOptions } from '@/lib/time-zones';
import {
  installLicenceAction,
  setTrustedProxiesAction,
  updateOrganisationAction,
  updateSettingAction,
} from './actions';

export const metadata: Metadata = { title: 'Settings' };

const STATE_LABELS = {
  valid: { text: 'Valid', tone: 'badge-success' },
  expiring: { text: 'Expiring soon', tone: 'badge-warning' },
  grace: { text: 'Expired, in grace period', tone: 'badge-danger' },
  lapsed: { text: 'Expired: read-only', tone: 'badge-danger' },
  evaluation: { text: 'Evaluation', tone: 'badge-warning' },
  unlicensed: { text: 'No licence: read-only', tone: 'badge-danger' },
  invalid: { text: 'Not usable: read-only', tone: 'badge-danger' },
} as const;

export default async function SettingsPage() {
  const session = await requirePermission('settings.view');
  const organisation = await getOrganisation(db(), session.actor);
  const licence = session.licence;
  const label = STATE_LABELS[licence.state];
  const edit = can(session.actor, 'settings.edit');
  const proxies = await trustedProxies(db());
  const rules = await listSettings(db(), session.actor);

  return (
    <>
      <h1>Settings</h1>
      <p>
        <Link href="/settings/reporting">Reporting login for Power BI or Excel</Link>
      </p>
      <section className="panel" aria-labelledby="org-heading">
        <h2 id="org-heading">Organisation</h2>
        {edit ? (
          <ActionForm action={updateOrganisationAction} submitLabel="Save organisation">
            <Field
              name="name"
              label="Organisation name"
              defaultValue={organisation.name}
              hint="Shown at the top of every page."
              required
            />
            <div className="form-grid">
              <Field
                name="countryCode"
                label="Country code"
                defaultValue={organisation.country_code}
                maxLength={2}
                autoCapitalize="characters"
              />
              <SelectField
                name="defaultTimeZone"
                label="Time zone for new sites"
                options={timeZoneOptions()}
                defaultValue={organisation.default_time_zone}
              />
            </div>
          </ActionForm>
        ) : (
          <p>{organisation.name}</p>
        )}
      </section>

      <section className="panel" id="working-rules" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Working rules</h2>
        <p className="muted">
          How reminders and check-outs behave. Reminder days are separated by commas, longest first
          or in any order.
        </p>
        <ul className="plain stack">
          {rules.map((r) => (
            <li key={r.key}>
              {edit ? (
                <ActionForm action={updateSettingAction} submitLabel={`Save: ${r.label}`}>
                  <input type="hidden" name="key" value={r.key} />
                  <Field
                    name="value"
                    label={r.label}
                    defaultValue={Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}
                    hint={r.description}
                  />
                </ActionForm>
              ) : (
                <p>
                  <strong>{r.label}:</strong>{' '}
                  {Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" id="licence" aria-labelledby="licence-heading">
        <h2 id="licence-heading">Licence</h2>
        <p>
          <span className={`badge ${label.tone}`}>{label.text}</span>
        </p>
        <dl className="details">
          <dt>Licensed to</dt>
          <dd>{orDash(licence.payload?.licensee)}</dd>
          <dt>Reference</dt>
          <dd>{orDash(licence.payload?.licenceRef)}</dd>
          <dt>Runs to</dt>
          <dd>
            {licence.payload
              ? licence.payload.expiresOn
                ? ukDate(licence.payload.expiresOn)
                : 'No end date'
              : '—'}
          </dd>
          <dt>Sites covered</dt>
          <dd>{licence.payload ? (licence.payload.maxSites ?? 'No limit') : '—'}</dd>
          <dt>This version</dt>
          <dd>{PRODUCT_VERSION}</dd>
        </dl>
        {licence.message ? <p>{licence.message}</p> : null}
        <p className="muted small">
          The licence is checked on this server only: NorthKit never contacts NorthSpec. If it
          lapses, nothing is deleted or locked: everything stays visible and exportable, and new
          work pauses until a renewal is installed.
        </p>
        {session.actor.administrator ? (
          <ActionForm action={installLicenceAction} submitLabel="Install licence">
            <div className="field">
              <label htmlFor="licence-file">Licence file</label>
              <input
                id="licence-file"
                name="file"
                type="file"
                accept=".licence,.json,application/json,text/plain"
              />
            </div>
            <Field
              name="licence"
              label="Or paste the licence text"
              hint="Everything from the first { to the last }."
              autoComplete="off"
              spellCheck={false}
            />
          </ActionForm>
        ) : (
          <p className="muted">Only an administrator can install a licence.</p>
        )}
      </section>

      <section className="panel" id="network" aria-labelledby="network-heading">
        <h2 id="network-heading">Reverse proxy</h2>
        <p>
          Public report limits count reports per connecting address. If NorthKit sits behind your
          own reverse proxy, every request seems to come from the proxy: name it here so the client
          address it forwards is used instead. Leave it blank if there is no proxy; forwarded
          addresses are then ignored, because anyone can send one.
        </p>
        <p>
          {proxies.length
            ? `Trusted now: ${proxies.join(', ')}.`
            : 'No proxy named: the connecting address is used.'}
        </p>
        {session.actor.administrator ? (
          <ActionForm action={setTrustedProxiesAction} submitLabel="Save reverse proxy">
            <Field
              name="trustedProxies"
              label="Reverse proxy addresses"
              hint="For example 10.0.0.5, or a range like 10.0.0.0/24. Separate several with commas."
              defaultValue={proxies.map((p) => p.replace(/\/(32|128)$/, '')).join(', ')}
              autoComplete="off"
              spellCheck={false}
            />
          </ActionForm>
        ) : (
          <p className="muted">Only an administrator can change this.</p>
        )}
      </section>
    </>
  );
}
