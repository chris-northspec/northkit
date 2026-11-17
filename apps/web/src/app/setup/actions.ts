'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { completeFirstRun, ValidationError } from '@northkit/core';
import type { FormState } from '@/lib/form-state';
import { formAction, raw, text } from '@/lib/server/actions';
import { db } from '@/lib/server/db';
import { cookieOptions, requestInfo, SESSION_COOKIE, TWO_FACTOR_PATH } from '@/lib/server/session';

// Field names in core that differ from this form's inputs.
const FIELD_MAP: Record<string, string> = {
  code: 'siteCode',
  name: 'siteName',
  'organisation.name': 'organisationName',
  'organisation.defaultTimeZone': 'timeZone',
};

export async function setupAction(_state: FormState, form: FormData): Promise<FormState> {
  return formAction(form, async () => {
    const password = raw(form, 'password');
    if (password !== raw(form, 'confirmPassword'))
      throw new ValidationError('The passwords don’t match.', {
        confirmPassword: 'Type the same password twice.',
      });
    const timeZone = text(form, 'timeZone') || 'Europe/London';
    let session: { token: string; expiresAt: Date };
    try {
      session = await completeFirstRun(
        db(),
        {
          setupCode: text(form, 'setupCode'),
          organisation: { name: text(form, 'organisationName'), defaultTimeZone: timeZone },
          admin: { displayName: text(form, 'displayName'), email: text(form, 'email'), password },
          site: {
            code: text(form, 'siteCode'),
            name: text(form, 'siteName'),
            town: text(form, 'town'),
            postcode: text(form, 'postcode'),
            timeZone,
          },
        },
        await requestInfo(),
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        const fields = Object.fromEntries(
          Object.entries(error.fields).map(([key, message]) => [FIELD_MAP[key] ?? key, message]),
        );
        throw new ValidationError(error.message, fields);
      }
      throw error;
    }
    (await cookies()).set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt));
    // The Administrator role requires two-factor sign-in: that comes next.
    redirect(TWO_FACTOR_PATH);
  });
}
