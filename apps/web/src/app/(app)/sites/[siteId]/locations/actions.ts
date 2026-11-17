'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createLocation,
  setLocationArchived,
  updateLocation,
  type LocationInput,
  type LocationKind,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

function locationInput(form: FormData): LocationInput {
  return {
    code: text(form, 'code'),
    name: text(form, 'name'),
    kind: text(form, 'kind') as LocationKind,
    parentId: text(form, 'parentId') || null,
    reference: text(form, 'reference'),
    notes: text(form, 'notes'),
  };
}

export async function createLocationAction(
  siteId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const location = await createLocation(db(), session.actor, siteId, locationInput(form));
    revalidatePath(`/sites/${siteId}/locations`);
    return { message: `Location ${location.code} added.` };
  });
}

export async function updateLocationAction(
  siteId: string,
  id: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await updateLocation(db(), session.actor, id, rowVersion, locationInput(form));
    redirect(`/sites/${siteId}/locations/${id}`);
  });
}

export async function setLocationArchivedAction(
  siteId: string,
  id: string,
  rowVersion: number,
  archived: boolean,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await setLocationArchived(db(), session.actor, id, rowVersion, archived);
    revalidatePath(`/sites/${siteId}/locations/${id}`);
    return { message: archived ? 'Location archived.' : 'Location restored.' };
  });
}
