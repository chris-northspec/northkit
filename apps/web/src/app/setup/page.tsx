import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFirstRun, PASSWORD_MIN_LENGTH } from '@northkit/core';
import { optionalEnv } from '@northkit/db';
import { ActionForm, Field, SelectField } from '@/components/form/action-form';
import { ProductMark } from '@/components/product-mark';
import { timeZoneOptions } from '@/lib/time-zones';
import { db } from '@/lib/server/db';
import { setupAction } from './actions';

export const metadata: Metadata = { title: 'Set up' };
export const dynamic = 'force-dynamic';

/**
 * S1-7: first-run set-up (copied from NorthCore WMS). Exists only while the database has
 * no users; afterwards it is a 404. There is no default account or password, and the
 * administrator sets up two-factor sign-in straight after.
 */
export default async function SetupPage() {
  if (!(await isFirstRun(db()))) notFound();
  // Never sent to the browser: only whether one exists.
  const codeConfigured = Boolean(optionalEnv('NORTHKIT_SETUP_CODE'));

  return (
    <main className="auth-page">
      <div className="auth-card auth-card-wide">
        <p className="auth-product">
          <ProductMark />
        </p>
        <h1>Set up NorthKit</h1>
        <p>
          Name your organisation and create the first administrator and your first depot. You can
          add more depots, locations and users afterwards.
        </p>
        {codeConfigured ? null : (
          <p className="form-error" role="alert">
            Set-up is locked: this server has no set-up code. Run{' '}
            <code>sh deploy/install.sh --new-setup-code</code> and restart the web service.
          </p>
        )}
        <ActionForm action={setupAction} submitLabel="Finish set-up" pendingLabel="Setting up…">
          <Field
            name="setupCode"
            label="Set-up code"
            hint="Shown once when NorthKit was installed, and kept in deploy/.env on the server. Ask whoever installed it."
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            autoFocus
          />
          <fieldset className="stack">
            <legend>Your organisation</legend>
            <Field
              name="organisationName"
              label="Organisation name"
              autoComplete="organization"
              required
            />
            <SelectField
              name="timeZone"
              label="Time zone"
              options={timeZoneOptions()}
              defaultValue="Europe/London"
            />
          </fieldset>
          <fieldset className="stack">
            <legend>You (administrator)</legend>
            <Field name="displayName" label="Your name" autoComplete="name" required />
            <Field name="email" label="Email" type="email" autoComplete="username" required />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence is easy to remember. You’ll set up two-factor sign-in next.`}
              required
            />
            <Field
              name="confirmPassword"
              label="Password again"
              type="password"
              autoComplete="new-password"
              required
            />
          </fieldset>
          <fieldset className="stack">
            <legend>Your first depot</legend>
            <Field
              name="siteCode"
              label="Depot reference"
              hint="Short code for screens and QR posters, e.g. NTH1."
              autoCapitalize="characters"
              maxLength={20}
              required
            />
            <Field name="siteName" label="Depot name" required />
            <Field name="town" label="Town" />
            <Field name="postcode" label="Postcode" autoComplete="postal-code" />
          </fieldset>
        </ActionForm>
      </div>
      <footer className="powered-by">Powered by NorthSpec</footer>
    </main>
  );
}
