import { createPublicKey, verify, type KeyObject } from 'node:crypto';

// Offline licence check (S1-7, studio standard 09). A licence is a small JSON file
// NorthSpec signs with its Ed25519 private key; the product verifies the signature
// against the public key built into the code. Nothing is ever sent anywhere: no call
// home, so an air-gapped site or an unreachable payment service never counts as expiry.
//
// The safety rule is absolute: a licence problem never deletes data or locks anyone
// out of their records. The worst state is read-only, where everything stays visible
// and exportable and only new work is paused.

export const LICENCE_FORMAT = 'northkit-licence-1';
export const PRODUCT_CODE = 'northkit';

/** Days before expiry when the warning banner starts, then gets louder. */
export const WARNING_DAYS = [60, 30, 7] as const;
/** Days after expiry that everything keeps working, with a prominent notice. */
export const DEFAULT_GRACE_DAYS = 30;
/** Days a new install runs fully before a licence is installed. */
export const EVALUATION_DAYS = 30;

export interface LicencePayload {
  product: typeof PRODUCT_CODE;
  /** NorthSpec's reference, e.g. NK-2026-0001. */
  licenceRef: string;
  /** Customer the licence is issued to. */
  licensee: string;
  /** 'YYYY-MM-DD'. */
  issuedOn: string;
  /** Last day covered, 'YYYY-MM-DD'; null for perpetual. */
  expiresOn: string | null;
  /** Major versions covered, inclusive: [0, 1] covers 0.x and 1.x. */
  majorVersions: [number, number];
  /** Most live sites allowed; null for no limit. */
  maxSites: number | null;
  /** Days of full use after expiry; defaults to DEFAULT_GRACE_DAYS. */
  graceDays?: number;
}

/** The file as delivered: the payload bytes (base64url JSON) and their signature. */
export interface LicenceFile {
  format: typeof LICENCE_FORMAT;
  keyId: string;
  payload: string;
  signature: string;
}

export type LicenceState =
  /** Signed, in date and covering this version. */
  | 'valid'
  /** Valid, but expires within WARNING_DAYS. */
  | 'expiring'
  /** Past its expiry date but inside the grace period: still fully working. */
  | 'grace'
  /** Past the grace period: read-only. */
  | 'lapsed'
  /** No licence installed, inside the evaluation period: fully working. */
  | 'evaluation'
  /** No licence installed and the evaluation period is over: read-only. */
  | 'unlicensed'
  /** A licence is installed but doesn't verify or doesn't cover this product or version: read-only. */
  | 'invalid';

export interface LicenceStatus {
  state: LicenceState;
  /** True when new work is paused: lapsed, unlicensed or invalid. */
  readOnly: boolean;
  /** One plain sentence for the banner; null when there is nothing to say. */
  message: string | null;
  /** How loud the banner is. */
  severity: 'none' | 'info' | 'warning' | 'critical';
  payload: LicencePayload | null;
  /** Days until expiry (negative once past), or until the evaluation ends. */
  daysLeft: number | null;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** A public key from its raw 32 bytes, base64. */
export function publicKeyFromRaw(base64: string): KeyObject {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== 32) throw new Error('An Ed25519 public key is 32 bytes.');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Checks the shape of a decoded payload; returns a reason, or null if it is sound. */
function payloadProblem(p: Partial<LicencePayload>): string | null {
  if (p.product !== PRODUCT_CODE) return 'This licence is for a different product.';
  if (typeof p.licenceRef !== 'string' || !p.licenceRef.trim() || p.licenceRef.length > 100)
    return 'The licence has no reference.';
  if (typeof p.licensee !== 'string' || !p.licensee.trim() || p.licensee.length > 200)
    return 'The licence has no licensee.';
  if (!isDate(p.issuedOn)) return 'The licence has no issue date.';
  if (p.expiresOn !== null && !isDate(p.expiresOn)) return 'The licence expiry date is not valid.';
  if (
    !Array.isArray(p.majorVersions) ||
    p.majorVersions.length !== 2 ||
    !p.majorVersions.every((v) => Number.isInteger(v) && v >= 0) ||
    p.majorVersions[0] > p.majorVersions[1]
  )
    return 'The licence version range is not valid.';
  if (p.maxSites !== null && !(Number.isInteger(p.maxSites) && (p.maxSites as number) > 0))
    return 'The licence site limit is not valid.';
  if (
    p.graceDays !== undefined &&
    !(Number.isInteger(p.graceDays) && p.graceDays >= 0 && p.graceDays <= 365)
  )
    return 'The licence grace period is not valid.';
  return null;
}

/** True if `signature` (base64url) is the trusted key's Ed25519 signature of `bytes`. */
function signatureMatches(bytes: Buffer, publicKey: string, signature: string): boolean {
  try {
    return verify(null, bytes, publicKeyFromRaw(publicKey), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export type ReadResult = { ok: true; payload: LicencePayload } | { ok: false; reason: string };

/**
 * Parses a licence file and verifies its signature against the trusted keys. Says
 * nothing about dates or versions; licenceStatus does that.
 */
export function readLicence(
  text: string,
  trustedKeys: Readonly<Record<string, string>>,
): ReadResult {
  let file: Partial<LicenceFile>;
  try {
    file = JSON.parse(text.trim()) as Partial<LicenceFile>;
  } catch {
    return { ok: false, reason: 'This is not a NorthKit licence file.' };
  }
  if (
    file?.format !== LICENCE_FORMAT ||
    typeof file.payload !== 'string' ||
    typeof file.signature !== 'string' ||
    typeof file.keyId !== 'string'
  )
    return { ok: false, reason: 'This is not a NorthKit licence file.' };
  const key = trustedKeys[file.keyId];
  if (!key) return { ok: false, reason: 'This licence was not signed by NorthSpec.' };
  const payloadBytes = Buffer.from(file.payload, 'base64url');
  if (!signatureMatches(payloadBytes, key, file.signature))
    return {
      ok: false,
      reason: 'This licence was not signed by NorthSpec, or it has been changed.',
    };
  let payload: Partial<LicencePayload>;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8')) as Partial<LicencePayload>;
  } catch {
    return { ok: false, reason: 'The licence contents can’t be read.' };
  }
  const problem = payloadProblem(payload);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, payload: payload as LicencePayload };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `today` to `date` (both 'YYYY-MM-DD', compared as UTC dates). */
function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
}

/** 'YYYY-MM-DD' for an instant, in UTC. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Formats 'YYYY-MM-DD' as a UK date, e.g. 14 November 2026. */
export function ukDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const READ_ONLY_NOTE =
  'Everything stays visible and you can still export your data; new work is paused until a licence is installed.';

export interface StatusInput {
  /** The newest installed licence file, or null if none has been installed. */
  licenceText: string | null;
  trustedKeys: Readonly<Record<string, string>>;
  /** This build's version, e.g. '0.1.0'. */
  productVersion: string;
  /** When the install was set up, for the evaluation period. */
  installedAt: Date | null;
  now?: Date;
}

/** Works out what the licence allows right now. Pure: the clock is passed in. */
export function licenceStatus(input: StatusInput): LicenceStatus {
  const now = input.now ?? new Date();
  const today = utcDate(now);

  if (input.licenceText === null) {
    const start = input.installedAt ?? now;
    const ends = utcDate(new Date(start.getTime() + EVALUATION_DAYS * DAY_MS));
    const left = daysBetween(today, ends);
    if (left > 0)
      return {
        state: 'evaluation',
        readOnly: false,
        severity: 'info',
        message: `Evaluation: ${plural(left, 'day')} left. Install your licence in Settings to keep adding work after ${ukDate(ends)}.`,
        payload: null,
        daysLeft: left,
      };
    return {
      state: 'unlicensed',
      readOnly: true,
      severity: 'critical',
      message: `No licence is installed and the evaluation has ended. ${READ_ONLY_NOTE}`,
      payload: null,
      daysLeft: left,
    };
  }

  const read = readLicence(input.licenceText, input.trustedKeys);
  if (!read.ok)
    return {
      state: 'invalid',
      readOnly: true,
      severity: 'critical',
      message: `The installed licence can’t be used: ${read.reason} ${READ_ONLY_NOTE}`,
      payload: null,
      daysLeft: null,
    };
  const payload = read.payload;
  const major = Number(input.productVersion.split('.')[0]);
  const [from, to] = payload.majorVersions;
  if (!(major >= from && major <= to))
    return {
      state: 'invalid',
      readOnly: true,
      severity: 'critical',
      message: `Your licence covers versions ${from}.x to ${to}.x, and this is version ${input.productVersion}. ${READ_ONLY_NOTE}`,
      payload,
      daysLeft: null,
    };

  if (payload.expiresOn === null)
    return {
      state: 'valid',
      readOnly: false,
      severity: 'none',
      message: null,
      payload,
      daysLeft: null,
    };

  const left = daysBetween(today, payload.expiresOn);
  if (left >= 0) {
    if (left > WARNING_DAYS[0])
      return {
        state: 'valid',
        readOnly: false,
        severity: 'none',
        message: null,
        payload,
        daysLeft: left,
      };
    return {
      state: 'expiring',
      readOnly: false,
      severity: left <= WARNING_DAYS[2] ? 'warning' : 'info',
      message: `Your licence runs to ${ukDate(payload.expiresOn)} (${plural(left, 'day')} left). Renew it with NorthSpec and install the new file in Settings.`,
      payload,
      daysLeft: left,
    };
  }
  const grace = payload.graceDays ?? DEFAULT_GRACE_DAYS;
  const graceEnds = utcDate(new Date(Date.parse(payload.expiresOn) + grace * DAY_MS));
  if (daysBetween(today, graceEnds) >= 0)
    return {
      state: 'grace',
      readOnly: false,
      severity: 'critical',
      message: `Your licence expired on ${ukDate(payload.expiresOn)}. Everything keeps working until ${ukDate(graceEnds)}; after that new work is paused. Install a renewed licence in Settings.`,
      payload,
      daysLeft: left,
    };
  return {
    state: 'lapsed',
    readOnly: true,
    severity: 'critical',
    message: `Your licence expired on ${ukDate(payload.expiresOn)}. ${READ_ONLY_NOTE}`,
    payload,
    daysLeft: left,
  };
}
