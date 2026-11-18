import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepoRoot, optionalEnv } from '@northkit/db';

// The files volume: item photos and uploaded import files. In Docker it is /data/files on
// the `files` volume (mounted for the web service AND the worker, which writes thumbnails);
// in development .data/files in the repo (git-ignored). Never anywhere outside the buyer's
// server. Only names NorthKit made are ever read or written: a key is checked against a
// pattern before it becomes a path.

export function filesDir(): string {
  return optionalEnv('NORTHKIT_FILES_DIR') ?? path.join(findRepoRoot(), '.data', 'files');
}

const KEY =
  /^(items\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.thumb)?\.(jpg|png|webp)|imports\/[0-9a-f-]{36}\.(csv|xlsx))$/;

export function filePath(key: string): string {
  if (!KEY.test(key)) throw new RangeError('Not a stored file name.');
  return path.join(filesDir(), ...key.split('/'));
}

export async function writeStored(key: string, bytes: Uint8Array): Promise<void> {
  const file = filePath(key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o750 });
  await writeFile(file, bytes, { mode: 0o640 });
}

export async function readStored(key: string): Promise<Buffer> {
  return readFile(filePath(key));
}

export async function removeStored(key: string): Promise<void> {
  await rm(filePath(key), { force: true });
}
