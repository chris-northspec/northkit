'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createRole, setRoleArchived, updateRole, type RoleInput } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { checked, formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

// Copied from NorthCore WMS and adapted: site scope and the two-factor rule only.

/** Ticked boxes named `<prefix><value>`, e.g. perm:estate.edit or site:<uuid>. */
function ticked(form: FormData, prefix: string): string[] {
  const out: string[] = [];
  for (const [key, value] of form.entries())
    if (key.startsWith(prefix) && value === 'on') out.push(key.slice(prefix.length));
  return out;
}

function roleFromForm(form: FormData): RoleInput {
  return {
    name: text(form, 'name'),
    description: text(form, 'description'),
    permissions: ticked(form, 'perm:'),
    siteScope: text(form, 'siteScope') === 'listed' ? 'listed' : 'all',
    siteIds: ticked(form, 'site:'),
    requiresMfa: checked(form, 'requiresMfa'),
  };
}

export async function createRoleAction(_state: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const role = await createRole(db(), actor, roleFromForm(form));
    revalidatePath('/roles');
    redirect(`/roles/${role.id}?saved=1`);
  });
}

export async function updateRoleAction(
  roleId: string,
  rowVersion: number,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await updateRole(db(), actor, roleId, rowVersion, roleFromForm(form));
    revalidatePath('/roles');
    redirect(`/roles/${roleId}?saved=1`);
  });
}

export async function archiveRoleAction(
  roleId: string,
  rowVersion: number,
  archive: boolean,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await setRoleArchived(db(), actor, roleId, rowVersion, archive);
    revalidatePath('/roles');
    redirect(`/roles/${roleId}`);
  });
}
