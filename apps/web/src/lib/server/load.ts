import 'server-only';
import { notFound } from 'next/navigation';
import { NotFoundError } from '@northkit/core';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route id that isn't a UUID can't name anything: 404 rather than a database error. */
export function routeId(value: string): string {
  if (!UUID.test(value)) notFound();
  return value;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Loads a record for a page; missing or out of the user's scope is a 404 (deliberately the same). */
export async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
