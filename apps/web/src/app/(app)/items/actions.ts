'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addItemPhoto,
  createItem,
  deleteItemPhoto,
  markFound,
  replaceItemLabel,
  retireItem,
  setItemKit,
  updateItem,
  ValidationError,
  type ItemInput,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { checked, formAction, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

// Server actions for the item register. Each can be called directly, without its page, so
// each checks the session; the services check the permission and depot scope again, and
// row-level security checks once more.

function itemInput(form: FormData): ItemInput {
  return {
    siteId: text(form, 'siteId'),
    kindId: text(form, 'kindId'),
    assetNumber: text(form, 'assetNumber'),
    serialNumber: text(form, 'serialNumber'),
    make: text(form, 'make'),
    model: text(form, 'model'),
    description: text(form, 'description'),
    purchaseDate: text(form, 'purchaseDate'),
    cost: text(form, 'cost'),
    ownership: (text(form, 'ownership') || 'owned') as 'owned' | 'hired_in',
    hireCompany: text(form, 'hireCompany'),
    hireReference: text(form, 'hireReference'),
    offHireDate: text(form, 'offHireDate'),
    locationId: text(form, 'locationId') || null,
    isKit: checked(form, 'isKit'),
    notes: text(form, 'notes'),
  };
}

export async function createItemAction(_s: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const item = await createItem(db(), session.actor, itemInput(form));
    redirect(`/items/${item.id}`);
  });
}

export async function updateItemAction(
  itemId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await updateItem(db(), session.actor, itemId, rowVersion, itemInput(form));
    redirect(`/items/${itemId}`);
  });
}

export async function retireItemAction(
  itemId: string,
  rowVersion: number,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await retireItem(db(), session.actor, itemId, rowVersion, text(form, 'reason'));
    revalidatePath(`/items/${itemId}`);
    redirect(`/items/${itemId}`);
  });
}

/** Adds the item to a kit (kitId from the form) or, with an empty kit, takes it out. */
export async function setKitAction(
  itemId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await setItemKit(db(), session.actor, itemId, text(form, 'kitId') || null);
    revalidatePath(`/items/${itemId}`);
    return { message: 'Saved.' };
  });
}

export async function removeFromKitAction(
  kitId: string,
  itemId: string,
  _s: FormState,
  _form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(new FormData(), async () => {
    await setItemKit(db(), session.actor, itemId, null);
    revalidatePath(`/items/${kitId}`);
    return { message: 'Taken out of the kit.' };
  });
}

export async function replaceLabelAction(
  itemId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await replaceItemLabel(db(), session.actor, itemId);
    revalidatePath(`/items/${itemId}`);
    return {
      message: 'Label replaced. Every older print of it has stopped working: print the new one.',
    };
  });
}

/** Photos from the item page: one or several files in one go; each is checked on its own. */
export async function addPhotosAction(
  itemId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0)
      throw new ValidationError('Choose a photo to add.', { photos: 'Choose at least one photo.' });
    const refused: string[] = [];
    let added = 0;
    for (const file of files) {
      try {
        await addItemPhoto(db(), session.actor, itemId, Buffer.from(await file.arrayBuffer()));
        added += 1;
      } catch (error) {
        if (error instanceof ValidationError) refused.push(`${file.name}: ${error.message}`);
        else throw error;
      }
    }
    revalidatePath(`/items/${itemId}`);
    if (refused.length)
      return {
        error: `${added ? `${added} added. ` : ''}Not added: ${refused.join(' ')}`,
      };
    return { message: added === 1 ? 'Photo added.' : `${added} photos added.` };
  });
}

export async function deletePhotoAction(
  itemId: string,
  photoId: string,
  _s: FormState,
  _form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(new FormData(), async () => {
    await deleteItemPhoto(db(), session.actor, photoId);
    revalidatePath(`/items/${itemId}`);
    return { message: 'Photo removed.' };
  });
}

/** Records a missing item as found, where it was found (a Supervisor or above). */
export async function markFoundAction(
  itemId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const result = await markFound(db(), session.actor, {
      itemId,
      locationId: text(form, 'locationId'),
      note: text(form, 'note'),
    });
    revalidatePath(`/items/${itemId}`);
    return { message: result.message };
  });
}
