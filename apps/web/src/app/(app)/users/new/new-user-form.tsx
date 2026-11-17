'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ActionForm, Field, type FormActionFn } from '@/components/form/action-form';

/** The add-user form; after saving it shows the temporary password once. */
export function NewUserForm({ action, children }: { action: FormActionFn; children: ReactNode }) {
  return (
    <ActionForm
      action={action}
      submitLabel="Add user"
      pendingLabel="Adding…"
      className="stack"
      result={(state) => {
        const data = state.data as { userId: string; password: string } | undefined;
        return data ? (
          <section className="panel space-above" aria-labelledby="password-heading">
            <h2 id="password-heading">Their temporary password</h2>
            <p className="secret">{data.password}</p>
            <p>
              Give it to them in person. It isn’t shown again; they must change it when they first
              sign in.
            </p>
            <Link href={`/users/${data.userId}`}>Go to their page</Link>
          </section>
        ) : null;
      }}
    >
      <div className="form-grid">
        <Field name="displayName" label="Name" autoComplete="off" required />
        <Field name="email" label="Email" type="email" autoComplete="off" required />
        <Field name="phone" label="Phone" type="tel" autoComplete="off" />
      </div>
      {children}
    </ActionForm>
  );
}
