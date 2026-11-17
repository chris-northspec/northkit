'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { completeMfa, getSession, signIn, signOut, type SignInResult } from '@northkit/core';
import { z } from 'zod';
import { db } from '@/lib/server/db';
import {
  cookieOptions,
  homeFor,
  MFA_COOKIE,
  requestInfo,
  SESSION_COOKIE,
} from '@/lib/server/session';

export interface SignInState {
  step: 'password' | 'code';
  error?: string;
  email?: string;
}

const passwordForm = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});
const codeForm = z.object({ code: z.string().trim().min(1).max(12) });

function lockedMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an administrator.`;
}

async function finish(result: Extract<SignInResult, { kind: 'signed_in' }>): Promise<never> {
  const jar = await cookies();
  jar.delete(MFA_COOKIE);
  jar.set(SESSION_COOKIE, result.token, cookieOptions(result.expiresAt));
  const session = await getSession(db(), result.token);
  redirect(session ? homeFor(session) : '/');
}

export async function signInAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const parsed = passwordForm.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  const typed = form.get('email');
  const email = typeof typed === 'string' ? typed.slice(0, 254) : '';
  if (!parsed.success) return { step: 'password', email, error: 'Enter your email and password.' };

  const result = await signIn(db(), parsed.data, await requestInfo());
  switch (result.kind) {
    case 'signed_in':
      return finish(result);
    case 'mfa_required':
      (await cookies()).set(MFA_COOKIE, result.token, cookieOptions(result.expiresAt));
      return { step: 'code' };
    case 'locked':
      return { step: 'password', email, error: lockedMessage(result.until) };
    default:
      return { step: 'password', email, error: 'That email and password don’t match an account.' };
  }
}

export async function codeAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const pending = (await cookies()).get(MFA_COOKIE)?.value;
  if (!pending) return { step: 'password', error: 'That took too long. Sign in again.' };
  const parsed = codeForm.safeParse({ code: form.get('code') });
  if (!parsed.success)
    return { step: 'code', error: 'Enter the 6-digit code from your authenticator app.' };

  const result = await completeMfa(db(), pending, parsed.data.code, await requestInfo());
  switch (result.kind) {
    case 'signed_in':
      return finish(result);
    case 'locked':
      (await cookies()).delete(MFA_COOKIE);
      return { step: 'password', error: lockedMessage(result.until) };
    default:
      return { step: 'code', error: 'That code didn’t work. Check your app and try again.' };
  }
}

/** One entry point for the sign-in form; the hidden `step` field says which step was submitted. */
export async function authAction(previous: SignInState, form: FormData): Promise<SignInState> {
  return form.get('step') === 'code' ? codeAction(previous, form) : signInAction(previous, form);
}

export async function signOutAction(): Promise<never> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await signOut(db(), token, await requestInfo());
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
