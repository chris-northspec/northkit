'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  archiveUser,
  createUser,
  resetPassword,
  resetUserMfa,
  restoreUser,
  setUserAccess,
  temporaryPassword,
  updateUser,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { checked, formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

/** Ticked boxes named `<prefix><value>`. */
function ticked(form: FormData, prefix: string): string[] {
  const out: string[] = [];
  for (const [key, value] of form.entries())
    if (key.startsWith(prefix) && value === 'on') out.push(key.slice(prefix.length));
  return out;
}

function access(form: FormData) {
  return {
    roles: ticked(form, 'role:'),
    allSites: checked(form, 'allSites'),
    siteIds: ticked(form, 'site:'),
  };
}

/**
 * Adds a user with a temporary password shown once to the person adding them; the new
 * user must choose their own at first sign-in.
 */
export async function createUserAction(_s: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const password = temporaryPassword();
    const user = await createUser(db(), actor, {
      email: text(form, 'email'),
      displayName: text(form, 'displayName'),
      phone: text(form, 'phone'),
      password,
      ...access(form),
    });
    revalidatePath('/users');
    return {
      message: `${user.display_name} added.`,
      data: { userId: user.id, password },
    };
  });
}

export async function updateUserAction(
  userId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await updateUser(db(), actor, userId, rowVersion, {
      email: text(form, 'email'),
      displayName: text(form, 'displayName'),
      phone: text(form, 'phone'),
    });
    redirect(`/users/${userId}?saved=1`);
  });
}

export async function setAccessAction(
  userId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await setUserAccess(db(), actor, userId, access(form));
    revalidatePath(`/users/${userId}`);
    return { message: 'Access saved. It applies from their next page.' };
  });
}

export async function resetPasswordAction(
  userId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const password = temporaryPassword();
    await resetPassword(db(), actor, userId, password);
    return {
      message: `Temporary password: ${password}. Give it to them in person; they must change it when they sign in. They have been signed out everywhere.`,
    };
  });
}

export async function resetMfaAction(
  userId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await resetUserMfa(db(), actor, userId);
    revalidatePath(`/users/${userId}`);
    return { message: 'Two-factor sign-in reset. They set it up again at their next sign-in.' };
  });
}

export async function setArchivedAction(
  userId: string,
  rowVersion: number,
  archive: boolean,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    if (archive) await archiveUser(db(), actor, userId, rowVersion);
    else await restoreUser(db(), actor, userId, rowVersion);
    revalidatePath(`/users/${userId}`);
    return { message: archive ? 'User archived and signed out.' : 'User restored.' };
  });
}
