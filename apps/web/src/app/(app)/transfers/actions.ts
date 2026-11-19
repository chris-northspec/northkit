'use server';

import { revalidatePath } from 'next/cache';
import { cancelTransfer, receiveTransfer, sendTransfer } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

// Server actions for transfers between depots (S3-3). Each checks the session; the
// services check the permission and the depot, and the database checks the rules.

export async function sendTransferAction(
  itemId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const result = await sendTransfer(db(), session.actor, {
      itemId,
      toSiteId: text(form, 'toSiteId'),
      carrier: text(form, 'carrier'),
      expectedOn: text(form, 'expectedOn'),
      note: text(form, 'note'),
    });
    revalidatePath(`/items/${itemId}`);
    revalidatePath('/transfers');
    return { message: result.message };
  });
}

export async function receiveTransferAction(
  transferId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const result = await receiveTransfer(db(), session.actor, {
      transferId,
      locationId: text(form, 'locationId'),
      note: text(form, 'note'),
    });
    revalidatePath('/transfers');
    revalidatePath('/items');
    return { message: result.message };
  });
}

export async function cancelTransferAction(
  transferId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const result = await cancelTransfer(
      db(),
      session.actor,
      transferId,
      text(form, 'locationId'),
      text(form, 'note'),
    );
    revalidatePath('/transfers');
    revalidatePath('/items');
    return { message: result.message };
  });
}
