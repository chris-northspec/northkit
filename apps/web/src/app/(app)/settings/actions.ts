'use server';

import { revalidatePath } from 'next/cache';
import {
  installLicence,
  setTrustedProxies,
  updateOrganisation,
  updateSetting,
  ValidationError,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

export async function updateOrganisationAction(_s: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    await updateOrganisation(db(), actor, {
      name: text(form, 'name'),
      countryCode: text(form, 'countryCode') || 'GB',
      defaultTimeZone: text(form, 'defaultTimeZone') || 'Europe/London',
    });
    revalidatePath('/', 'layout');
    return { message: 'Organisation saved.' };
  });
}

/** A licence file uploaded, or its text pasted. Allowed while read-only (S1-7). */
export async function installLicenceAction(_s: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const file = form.get('file');
    const body = file instanceof File && file.size > 0 ? await file.text() : text(form, 'licence');
    if (!body)
      throw new ValidationError('Choose the licence file NorthSpec sent you, or paste its text.', {
        licence: 'Choose a file or paste the text.',
      });
    if (body.length > 20_000)
      throw new ValidationError('That is not a NorthKit licence file.', { licence: 'Too long.' });
    const payload = await installLicence(db(), actor, body);
    revalidatePath('/', 'layout');
    return { message: `Licence ${payload.licenceRef} for ${payload.licensee} installed.` };
  });
}

/** The customer's reverse proxy (D15): only then are forwarded client addresses believed. */
export async function setTrustedProxiesAction(_s: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const saved = await setTrustedProxies(db(), actor, text(form, 'trustedProxies'));
    revalidatePath('/settings');
    return {
      message: saved.length
        ? `Forwarded client addresses are now used only for requests from ${saved.join(', ')}.`
        : 'No reverse proxy named: the connecting address is used for every request.',
    };
  });
}

/** One working rule (reminder days, days out, timeout warning). The value is a number, or comma-separated numbers. */
export async function updateSettingAction(_s: FormState, form: FormData): Promise<FormState> {
  const { actor } = await requireSession();
  return formAction(form, async () => {
    const key = text(form, 'key');
    const raw = text(form, 'value');
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0 || parts.some((p) => !/^d+$/.test(p)))
      throw new ValidationError('Use whole numbers only.', { value: 'Use whole numbers only.' });
    const numbers = parts.map(Number);
    // The two single-number rules take one number; reminder days take a list.
    await updateSetting(
      db(),
      actor,
      key,
      key === 'reminders.days_before_due' ? numbers : numbers[0],
    );
    revalidatePath('/settings');
    return { message: 'Saved.' };
  });
}
