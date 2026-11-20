'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { closeStocktake, type CloseStocktakeInput } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

/**
 * Closes a stocktake with the choices made on the result screen. Each choice is a field
 * named decision-<item id> (and reason-<item id> for an ignored item). Only the choices made
 * are applied; the service refuses a count with a line left undecided.
 */
export async function closeStocktakeAction(
  stocktakeId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const decisions: CloseStocktakeInput['decisions'] = {};
    for (const [key, value] of form.entries()) {
      const m = /^decision-([0-9a-f-]{36})$/.exec(key);
      if (!m || typeof value !== 'string' || !value) continue;
      decisions[m[1]!] = {
        decision: value as 'missing' | 'ignored' | 'moved_here' | 'note_only',
        reason: text(form, `reason-${m[1]}`),
      };
    }
    await closeStocktake(db(), session.actor, { stocktakeId, note: text(form, 'note'), decisions });
    revalidatePath('/stocktake');
    revalidatePath('/items');
    redirect(`/stocktake/${stocktakeId}`);
  });
}
