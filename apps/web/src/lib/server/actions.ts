import 'server-only';
import { DomainError, poundsToPence, ValidationError } from '@northkit/core';
import { isReadOnlyViolation } from '@northkit/db';
import type { FormState } from '../form-state';

/** Text fields from a form, without passwords or codes, to show again after an error. */
export function typedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string' || key.startsWith('$')) continue;
    if (/password|^totp$/i.test(key)) continue;
    values[key] = value.slice(0, 2000);
  }
  return values;
}

/** A string field, trimmed; '' when missing. */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** A string field exactly as typed (passwords: no trimming). */
export function raw(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** An optional string field: null when blank. */
export function optionalText(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

/** An optional whole number: null when blank, NaN (refused by validation) when not one. */
export function optionalInt(form: FormData, name: string): number | null {
  const value = text(form, name).replace(/,/g, '');
  if (value === '') return null;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** An optional decimal: null when blank, NaN (refused by validation) when not a number. */
export function optionalNumber(form: FormData, name: string): number | null {
  const value = text(form, name).replace(/,/g, '');
  if (value === '') return null;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** A decimal as typed, for the service to check exactly; null when empty (S5-0b). */
export function optionalDecimal(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value === '' ? null : value;
}

/**
 * Pounds as typed, as whole pence, exactly (never through a float); null when empty and
 * NaN when it isn't an amount of money, which the service's check then reports.
 */
export function optionalPence(form: FormData, name: string): number | null {
  const value = text(form, name);
  if (value === '') return null;
  return poundsToPence(value) ?? Number.NaN;
}

export const READ_ONLY_MESSAGE =
  'NorthKit is read-only until a current licence is installed, so this wasn’t saved. Everything stays visible and exportable.';

export function checked(form: FormData, name: string): boolean {
  return form.get(name) === 'on' || form.get(name) === 'true';
}

/**
 * Runs the body of a server action and turns domain errors into form state. Anything
 * else (including Next's redirect) is rethrown untouched.
 */
export async function formAction(
  form: FormData,
  body: () => Promise<FormState | void>,
): Promise<FormState> {
  try {
    return (await body()) ?? {};
  } catch (error) {
    if (error instanceof ValidationError) {
      return { error: error.message, fields: error.fields, values: typedValues(form) };
    }
    if (error instanceof DomainError) return { error: error.message, values: typedValues(form) };
    // The licence has lapsed: the database ran the transaction READ ONLY (S1-7).
    if (isReadOnlyViolation(error)) return { error: READ_ONLY_MESSAGE, values: typedValues(form) };
    throw error;
  }
}
