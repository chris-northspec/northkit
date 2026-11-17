'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { beginMfaEnrolment, confirmMfa, disableMfa, setHomeSite } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, raw, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requestInfo, requireSession, SITE_COOKIE, TWO_FACTOR_PATH } from '@/lib/server/session';

// Copied from NorthCore WMS. Set-up is allowed while it is still owed (the session can
// do nothing else until it's done).

export async function startMfaAction(_state: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession({ allowMfaSetup: true });
  return formAction(form, async () => {
    await beginMfaEnrolment(db(), session.user.id);
    revalidatePath(TWO_FACTOR_PATH);
  });
}

export async function confirmMfaAction(_state: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession({ allowMfaSetup: true });
  return formAction(form, async () => {
    await confirmMfa(db(), session.user.id, text(form, 'totp'), {
      sessionId: session.sessionId,
      ...(await requestInfo()),
    });
    // Someone who had to set it up can now get on with their work. The shell was drawn
    // for a restricted session (no menu), so it must be drawn again, not kept.
    if (session.user.mfaSetupRequired) {
      revalidatePath('/', 'layout');
      redirect('/');
    }
    revalidatePath(TWO_FACTOR_PATH);
    return { message: 'Two-factor sign-in is on. You’ll need a code each time you sign in.' };
  });
}

export async function disableMfaAction(_state: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await disableMfa(db(), session.user.id, raw(form, 'currentPassword'), text(form, 'totp'), {
      sessionId: session.sessionId,
      ...(await requestInfo()),
    });
    revalidatePath(TWO_FACTOR_PATH);
    return { message: 'Two-factor sign-in is off.' };
  });
}

/** "Open on": the site the site filter starts at when this browser remembers none (B-2). */
export async function homeSiteAction(_state: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const siteId = text(form, 'homeSiteId');
    await setHomeSite(db(), actor, siteId || null);
    // Forget this browser's last choice so the new home site applies straight away.
    (await cookies()).delete(SITE_COOKIE);
    revalidatePath('/', 'layout');
    return { message: 'Saved. The site filter now starts here.' };
  });
}
