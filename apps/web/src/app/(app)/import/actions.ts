'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  checkItemImport,
  INLINE_IMPORT_BYTES,
  loadItemImport,
  requestItemImportLoad,
  startItemImport,
  ValidationError,
} from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { requireSession } from '@/lib/server/session';

// Small files are checked (and, when asked, stored) in the request; larger ones wait for
// the worker, and the import page refreshes to show where they are.

export async function uploadImportAction(_s: FormState, form: FormData): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0)
      throw new ValidationError('Choose the spreadsheet to import.', {
        file: 'Choose a CSV or Excel file.',
      });
    const record = await startItemImport(
      db(),
      session.actor,
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    if (record.byte_size <= INLINE_IMPORT_BYTES) await checkItemImport(db(), record.id);
    redirect(`/import/${record.id}`);
  });
}

/** Stores a clean import: at once for a small file, by the worker for a large one. */
export async function storeImportAction(
  importId: string,
  _s: FormState,
  form: FormData,
): Promise<FormState> {
  const session = await requireSession();
  return formAction(form, async () => {
    await requestItemImportLoad(db(), session.actor, importId);
    const row = await db()
      .selectFrom('register.imports')
      .select('byte_size')
      .where('id', '=', importId)
      .executeTakeFirst();
    if (row && row.byte_size <= INLINE_IMPORT_BYTES) await loadItemImport(db(), importId);
    revalidatePath(`/import/${importId}`);
    redirect(`/import/${importId}`);
  });
}
