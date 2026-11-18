import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Field } from '@/components/form/action-form';
import { requirePermission } from '@/lib/server/session';
import { createKindAction } from '../actions';

export const metadata: Metadata = { title: 'Add a kind' };

export default async function NewKindPage() {
  await requirePermission('items.approve');
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/kinds">Kinds</Link>
      </p>
      <h1>Add a kind</h1>
      <ActionForm action={createKindAction} submitLabel="Add kind" pendingLabel="Adding…">
        <div className="form-grid">
          <Field name="name" label="Name" required maxLength={100} />
          <Field
            name="assetPrefix"
            label="Asset number prefix"
            hint="Optional, such as SC: items of this kind get SC-000001 and so on. Blank uses the organisation prefix."
            autoCapitalize="characters"
            maxLength={8}
          />
        </div>
        <Field name="description" label="What it covers" maxLength={1000} />
      </ActionForm>
      <p className="muted">You add its inspection rules on the next page.</p>
    </>
  );
}
