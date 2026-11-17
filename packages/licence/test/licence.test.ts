import { describe, expect, it } from 'vitest';
import { licenceStatus, readLicence, type StatusInput } from '../src/licence';
import { NORTHSPEC_PUBLIC_KEYS } from '../src/keys';
import { payload, signLicence, testKey } from './sign';

const key = testKey();
const keys = { [key.keyId]: key.publicKey };
const at = (date: string) => new Date(`${date}T12:00:00Z`);

function status(text: string | null, now: string, extra: Partial<StatusInput> = {}) {
  return licenceStatus({
    licenceText: text,
    trustedKeys: keys,
    productVersion: '0.1.0',
    installedAt: at('2026-11-14'),
    now: at(now),
    ...extra,
  });
}

describe('readLicence: signature (offline, no call home)', () => {
  it('accepts a file signed by a trusted key', () => {
    const result = readLicence(signLicence(key, payload()), keys);
    expect(result).toMatchObject({ ok: true, payload: { licensee: 'Example Logistics Ltd' } });
  });

  it('refuses a file whose payload was edited after signing', () => {
    const file = JSON.parse(signLicence(key, payload()));
    const body = JSON.parse(Buffer.from(file.payload, 'base64url').toString());
    body.expiresOn = '2099-12-31';
    file.payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    expect(readLicence(JSON.stringify(file), keys)).toMatchObject({ ok: false });
  });

  it('refuses a file signed by an unknown key, even one claiming a trusted key id', () => {
    const forger = testKey(key.keyId);
    expect(readLicence(signLicence(forger, payload()), keys)).toEqual({
      ok: false,
      reason: expect.stringMatching(/not signed by NorthSpec/),
    });
    const other = testKey('other');
    expect(readLicence(signLicence(other, payload()), keys)).toMatchObject({ ok: false });
  });

  it('refuses a licence for another product and rubbish input', () => {
    expect(
      readLicence(signLicence(key, payload({ product: 'northcore' as never })), keys),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/different product/),
    });
    expect(readLicence('not json', keys)).toMatchObject({ ok: false });
    expect(readLicence('{}', keys)).toMatchObject({ ok: false });
  });

  it('ships with no private key and only public keys', () => {
    for (const value of Object.values(NORTHSPEC_PUBLIC_KEYS))
      expect(Buffer.from(value, 'base64')).toHaveLength(32);
  });
});

describe('licenceStatus: graceful lapse to read-only (studio standard 09)', () => {
  const file = signLicence(key, payload({ expiresOn: '2027-10-31' }));

  it('is valid and quiet well before expiry', () => {
    expect(status(file, '2027-01-01')).toMatchObject({
      state: 'valid',
      readOnly: false,
      message: null,
    });
  });

  it('warns at 60, 30 and 7 days, getting louder', () => {
    expect(status(file, '2027-09-01')).toMatchObject({
      state: 'expiring',
      severity: 'info',
      daysLeft: 60,
    });
    expect(status(file, '2027-10-01')).toMatchObject({ state: 'expiring', daysLeft: 30 });
    expect(status(file, '2027-10-24')).toMatchObject({
      state: 'expiring',
      severity: 'warning',
      readOnly: false,
    });
    expect(status(file, '2027-10-31').message).toMatch(/31 October 2027 \(0 days left\)/);
  });

  it('keeps working through the grace period after expiry', () => {
    const s = status(file, '2027-11-15');
    expect(s).toMatchObject({ state: 'grace', readOnly: false, severity: 'critical' });
    expect(s.message).toMatch(/keeps working until 30 November 2027/);
    expect(status(file, '2027-11-30')).toMatchObject({ state: 'grace', readOnly: false });
  });

  it('goes read-only after the grace period, never a lock-out', () => {
    const s = status(file, '2027-12-01');
    expect(s).toMatchObject({ state: 'lapsed', readOnly: true });
    expect(s.message).toMatch(/still export your data/);
  });

  it('honours a custom grace period', () => {
    const short = signLicence(key, payload({ expiresOn: '2027-10-31', graceDays: 0 }));
    expect(status(short, '2027-10-31').state).toBe('expiring');
    expect(status(short, '2027-11-01').state).toBe('lapsed');
  });

  it('never expires a perpetual licence', () => {
    expect(status(signLicence(key, payload({ expiresOn: null })), '2099-01-01')).toMatchObject({
      state: 'valid',
      readOnly: false,
    });
  });

  it('goes read-only, not dark, when the version is not covered', () => {
    const old = signLicence(key, payload({ majorVersions: [1, 1] }));
    expect(status(old, '2027-01-01')).toMatchObject({ state: 'invalid', readOnly: true });
    expect(status(old, '2027-01-01', { productVersion: '1.4.0' }).state).toBe('valid');
  });

  it('goes read-only when the installed file does not verify', () => {
    expect(status('{"format":"northkit-licence-1"}', '2027-01-01')).toMatchObject({
      state: 'invalid',
      readOnly: true,
    });
  });

  it('runs fully for the evaluation period with no licence, then read-only', () => {
    expect(status(null, '2026-11-20')).toMatchObject({
      state: 'evaluation',
      readOnly: false,
      daysLeft: 24,
    });
    expect(status(null, '2026-12-14')).toMatchObject({ state: 'unlicensed', readOnly: true });
  });
});
