import { hash, verify, type Algorithm } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: 19 MiB, 2 passes, 1 lane.
// Algorithm is a const enum the package can't export at runtime; 2 is Argon2id.
const OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password.normalize('NFKC'), OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password.normalize('NFKC'));
  } catch {
    return false;
  }
}

/**
 * Burns the same time as a real check, so a sign-in attempt for an unknown email
 * can't be told apart from a wrong password by how long it takes.
 */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('not-a-real-password-used-for-timing-only');
  await verifyPassword(await dummyHash, password);
  return false;
}

/** ASVS L1 (2.1): length rules only, no composition rules. Returns a message or null. */
export function passwordProblem(password: string, email?: string): string | null {
  const length = [...password.normalize('NFKC')].length;
  if (length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH) return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'Your password can’t be your email address.';
  }
  return null;
}
