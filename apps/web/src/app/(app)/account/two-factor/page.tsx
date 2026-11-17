import type { Metadata } from 'next';
import Link from 'next/link';
import { getMfaStatus, qrSvg } from '@northkit/core';
import { ActionForm, Field } from '@/components/form/action-form';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';
import { confirmMfaAction, disableMfaAction, startMfaAction } from '../actions';

export const metadata: Metadata = { title: 'Two-factor sign-in' };

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });

/** Groups a base32 key in fours so it can be typed without losing your place. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

function RecoverySteps() {
  return (
    <section className="panel" aria-labelledby="recovery-heading">
      <h2 id="recovery-heading">If you lose your phone</h2>
      <ol className="steps stack">
        <li>
          Keep the set-up key somewhere safe, such as a password manager. You can add it to a new
          phone at any time.
        </li>
        <li>If your authenticator app can back up to your account, turn that on.</li>
        <li>
          If you lose both your phone and the key, ask an administrator to reset two-factor sign-in
          for you. You’ll then sign in with your password and set it up again.
        </li>
      </ol>
    </section>
  );
}

/**
 * Set up, confirm and turn off two-factor sign-in (TOTP). Copied from NorthCore WMS;
 * NorthKit sends a user here from every page while their role requires it and it
 * isn't on yet (the Administrator always does), and hides "turn off" for them.
 */
export default async function TwoFactorPage() {
  const session = await requireSession({ allowMfaSetup: true });
  const status = await getMfaStatus(db(), session.user.id);
  const owed = session.user.mfaSetupRequired;

  const back = owed ? null : (
    <p className="breadcrumbs">
      <Link href="/account">Your account</Link>
    </p>
  );
  const requiredNote = owed ? (
    <p className="notice notice-warning" role="status">
      <strong>Required.</strong> Your role needs two-factor sign-in. Set it up now to carry on.
    </p>
  ) : null;

  if (status.enabled) {
    return (
      <>
        {back}
        <h1>Two-factor sign-in</h1>
        <p>
          <span className="badge badge-success">On</span> since{' '}
          {status.enabledAt ? dateFormat.format(status.enabledAt) : 'set-up'}. You’ll need a code
          from your authenticator app each time you sign in.
        </p>
        <RecoverySteps />
        {status.required ? (
          <p className="muted">
            Your role requires two-factor sign-in, so it can’t be turned off. An administrator can
            reset it if you lose your phone.
          </p>
        ) : (
          <section className="stack" aria-labelledby="off-heading">
            <h2 id="off-heading">Turn two-factor sign-in off</h2>
            <p className="muted">
              Your account will only be protected by your password. Other devices will be signed
              out.
            </p>
            <ActionForm
              action={disableMfaAction}
              submitLabel="Turn off two-factor sign-in"
              submitClassName="button button-danger"
            >
              <Field
                name="currentPassword"
                label="Your password"
                type="password"
                autoComplete="current-password"
                required
              />
              <Field
                name="totp"
                label="Code from your app"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
              />
            </ActionForm>
          </section>
        )}
      </>
    );
  }

  if (!status.pending) {
    return (
      <>
        {back}
        <h1>Two-factor sign-in</h1>
        {requiredNote}
        <p>
          <span className="badge">Off</span> Two-factor sign-in asks for a 6-digit code from an
          authenticator app on your phone as well as your password, so a stolen password alone can’t
          be used to sign in as you.
        </p>
        <p className="muted">
          Any authenticator app works, for example the one built into your phone’s password manager.
          Nothing is sent outside this system.
        </p>
        <ActionForm
          action={startMfaAction}
          submitLabel="Set up two-factor sign-in"
          pendingLabel="Starting…"
        />
      </>
    );
  }

  const svg = qrSvg(status.pending.uri, { title: 'QR code for your authenticator app' });
  return (
    <>
      {back}
      <h1>Set up two-factor sign-in</h1>
      {requiredNote}
      <ol className="steps stack">
        <li>Open your authenticator app and choose to add an account.</li>
        <li>
          <p>Scan this QR code with it.</p>
          {/* Made on this server from the key below; no outside image service. */}
          <span className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p>Or type this set-up key into the app:</p>
          <p className="secret" aria-label="Set-up key" data-secret={status.pending.secret}>
            {grouped(status.pending.secret)}
          </p>
        </li>
        <li>Enter the 6-digit code the app shows to finish.</li>
      </ol>
      <ActionForm action={confirmMfaAction} submitLabel="Turn on two-factor sign-in">
        <Field
          name="totp"
          label="Code from your app"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          autoFocus
        />
      </ActionForm>
      <RecoverySteps />
      <ActionForm
        action={startMfaAction}
        submitLabel="Start again with a new key"
        submitClassName="button"
        pendingLabel="Starting…"
      />
    </>
  );
}
