import type { z } from 'zod';
import { ValidationError } from '../errors';

/** Parses input with a Zod schema, turning failures into a ValidationError with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new ValidationError('Check the highlighted fields.', fields);
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}
