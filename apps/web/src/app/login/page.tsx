import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isFirstRun } from '@northkit/core';
import { db } from '@/lib/server/db';
import { currentSession, homeFor, MFA_COOKIE } from '@/lib/server/session';
import { Illustration } from '@/components/illustration';
import { ProductMark } from '@/components/product-mark';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const session = await currentSession();
  if (session) redirect(homeFor(session));
  // A fresh install has no accounts: set-up comes first (S1-7).
  if (await isFirstRun(db())) redirect('/setup');
  const pendingCode = (await cookies()).has(MFA_COOKIE);

  return (
    <main className="auth-page auth-page-hero">
      {/* As ClearRate: the picture on the left, signing in on the right (from 1024 px). */}
      <div className="auth-hero" aria-hidden="true">
        <Illustration name="auth-hero" className="illustration-hero" />
        <p className="auth-tagline">Know where it is. Know it’s safe.</p>
      </div>
      <div className="auth-card">
        <p className="auth-product">
          <ProductMark />
        </p>
        <h1>Sign in</h1>
        <SignInForm initialStep={pendingCode ? 'code' : 'password'} />
        <p className="muted small">Forgotten your password? Ask an administrator to reset it.</p>
      </div>
      <footer className="powered-by">Powered by NorthSpec</footer>
    </main>
  );
}
