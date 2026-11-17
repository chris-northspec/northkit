import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  LICENCE_FORMAT,
  PRODUCT_CODE,
  type LicenceFile,
  type LicencePayload,
} from '../src/licence';

// Test-only signer with throwaway keys. The real generator and the NorthSpec private
// key never live in this repo (studio standard 09).

export interface TestKey {
  keyId: string;
  privateKey: KeyObject;
  /** Raw 32-byte public key, base64, as in src/keys.ts. */
  publicKey: string;
}

export function testKey(keyId = 'test-key'): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { keyId, privateKey, publicKey: der.subarray(der.length - 32).toString('base64') };
}

export function payload(overrides: Partial<LicencePayload> = {}): LicencePayload {
  return {
    product: PRODUCT_CODE,
    licenceRef: 'NK-TEST-0001',
    licensee: 'Example Logistics Ltd',
    issuedOn: '2026-11-01',
    expiresOn: '2027-10-31',
    majorVersions: [0, 1],
    maxSites: null,
    ...overrides,
  };
}

export function signLicence(key: TestKey, body: LicencePayload | Record<string, unknown>): string {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  const file: LicenceFile = {
    format: LICENCE_FORMAT,
    keyId: key.keyId,
    payload: bytes.toString('base64url'),
    signature: sign(null, bytes, key.privateKey).toString('base64url'),
  };
  return JSON.stringify(file, null, 2);
}
