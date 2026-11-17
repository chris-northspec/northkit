'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSite, setSiteArchived, updateSite, type SiteInput } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

// Server actions for sites (depots). Each can be called directly, without its page, so
// each checks the session; the services check the permission and site scope again, and
// RLS checks once more.

function siteInput(form: FormData): SiteInput {
  return {
    code: text(form, 'code'),
    name: text(form, 'name'),
    addressLine1: text(form, 'addressLine1'),
    addressLine2: text(form, 'addressLine2'),
    town: text(form, 'town'),
    postcode: text(form, 'postcode'),
    countryCode: text(form, 'countryCode') || 'GB',
    timeZone: text(form, 'timeZone') || 'Europe/London',
    phone: text(form, 'phone'),
    email: text(form, 'email'),
    managerUserId: text(form, 'managerUserId') || null,
    notes: text(form, 'notes'),
  };
}

export async function createSiteAction(_s: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const site = await createSite(db(), session.actor, siteInput(form), {
      maxSites: session.licence.payload?.maxSites ?? null,
    });
    redirect(`/sites/${site.id}`);
  });
}

export async function updateSiteAction(
  siteId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await updateSite(db(), session.actor, siteId, rowVersion, siteInput(form));
    redirect(`/sites/${siteId}`);
  });
}

export async function setSiteArchivedAction(
  siteId: string,
  rowVersion: number,
  archived: boolean,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await setSiteArchived(db(), session.actor, siteId, rowVersion, archived);
    revalidatePath(`/sites/${siteId}`);
    return { message: archived ? 'Depot archived.' : 'Depot restored.' };
  });
}
