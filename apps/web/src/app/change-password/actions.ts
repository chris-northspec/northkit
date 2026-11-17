'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { changeOwnPassword, getSession, ValidationError } from '@northkit/core';
import { cookies } from 'next/headers';
import { db } from '@/lib/server/db';
import { formAction, raw } from '@/lib/server/actions';
import type { FormState } from '@/lib/form-state';
import { homeFor, requestInfo, requireSession, SESSION_COOKIE } from '@/lib/server/session';

export async function changePasswordAction(_state: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession({ allowPasswordChange: true });
  return formAction(form, async () => {
    const next = raw(form, 'newPassword');
    if (next !== raw(form, 'confirmPassword')) {
      throw new ValidationError('The new passwords don’t match.', {
        confirmPassword: 'Type the same new password twice.',
      });
    }
    await changeOwnPassword(db(), session.user.id, raw(form, 'currentPassword'), next, {
      sessionId: session.sessionId,
      ...(await requestInfo()),
    });
    // Reload the session: the restrictions lift now the password has changed.
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
    const fresh = await getSession(db(), token);
    // The shell was drawn for a restricted session (no menu): draw it again.
    revalidatePath('/', 'layout');
    redirect(fresh ? homeFor(fresh) : '/login');
  });
}
