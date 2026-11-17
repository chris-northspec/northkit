import type { Metadata } from 'next';
import Link from 'next/link';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@northkit/core';
import { ActionForm, Field } from '@/components/form/action-form';
import { SignOutButton } from '@/components/sign-out-button';
import { ProductMark } from '@/components/product-mark';
import { homeFor, requireSession } from '@/lib/server/session';
import { changePasswordAction } from './actions';

export const metadata: Metadata = { title: 'Change your password' };

/**
 * S2-9. Reached from every page while an issued password is still in use, and from
 * the account page at any other time. Works at scanner size: same card as sign-in.
 */
export default async function ChangePasswordPage() {
  const session = await requireSession({ allowPasswordChange: true });
  const forced = session.user.mustChangePassword;

  return (
    <main className="auth-page">
      <div className="auth-card">
        <p className="auth-product">
          <ProductMark />
        </p>
        <h1>{forced ? 'Choose a new password' : 'Change your password'}</h1>
        {forced ? (
          <p>
            Your password was set by an administrator. Choose your own before you carry on. Other
            devices signed in as you will be signed out.
          </p>
        ) : (
          <p className="muted">Other devices signed in as you will be signed out.</p>
        )}
        <ActionForm action={changePasswordAction} submitLabel="Change password">
          <input type="hidden" name="username" autoComplete="username" value={session.user.email} />
          <Field
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
          <Field
            name="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={`${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters. A short sentence is easy to remember.`}
            required
          />
          <Field
            name="confirmPassword"
            label="New password again"
            type="password"
            autoComplete="new-password"
            required
          />
        </ActionForm>
        <div className="auth-links">
          {forced ? (
            <SignOutButton className="button button-link" />
          ) : (
            <Link href={homeFor(session)}>Cancel</Link>
          )}
        </div>
      </div>
      <footer className="powered-by">Powered by NorthSpec</footer>
    </main>
  );
}
