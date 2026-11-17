import { describe, expect, it } from 'vitest';
import { clientAddress, parseRange } from '../src/net/client-address';

// S3-10 (D15): forwarded addresses count only behind a proxy an administrator named.

describe('trusted reverse proxy off (the default)', () => {
  it('uses the connecting address and ignores a spoofed X-Forwarded-For', () => {
    expect(clientAddress({ peer: '203.0.113.7', forwardedFor: '198.51.100.1' }, [])).toBe(
      '203.0.113.7',
    );
    expect(clientAddress({ peer: '203.0.113.7', forwardedFor: null }, [])).toBe('203.0.113.7');
  });

  it('shows an IPv4-mapped connecting address as plain IPv4', () => {
    expect(clientAddress({ peer: '::ffff:203.0.113.7', forwardedFor: '1.2.3.4' }, [])).toBe(
      '203.0.113.7',
    );
  });

  it('returns nothing when the connecting address is unknown', () => {
    expect(clientAddress({ peer: null, forwardedFor: '198.51.100.1' }, [])).toBeNull();
  });
});

describe('trusted reverse proxy on', () => {
  const trusted = ['10.0.0.5/32', '172.16.0.0/12'];

  it('believes the forwarded client address from the named proxy', () => {
    expect(clientAddress({ peer: '10.0.0.5', forwardedFor: '198.51.100.1' }, trusted)).toBe(
      '198.51.100.1',
    );
  });

  it('takes the rightmost address the proxy added, not one a client typed further left', () => {
    // The client sent "X-Forwarded-For: 1.1.1.1"; the proxy appended the real address.
    expect(
      clientAddress({ peer: '10.0.0.5', forwardedFor: '1.1.1.1, 198.51.100.1' }, trusted),
    ).toBe('198.51.100.1');
  });

  it('skips a chain of named proxies', () => {
    expect(
      clientAddress(
        { peer: '10.0.0.5', forwardedFor: '1.1.1.1, 198.51.100.1, 172.20.1.1' },
        trusted,
      ),
    ).toBe('198.51.100.1');
  });

  it('ignores X-Forwarded-For from anyone who isn’t the named proxy', () => {
    expect(clientAddress({ peer: '203.0.113.7', forwardedFor: '198.51.100.1' }, trusted)).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to the connecting address when the header is mangled or missing', () => {
    expect(clientAddress({ peer: '10.0.0.5', forwardedFor: 'not-an-ip' }, trusted)).toBe(
      '10.0.0.5',
    );
    expect(clientAddress({ peer: '10.0.0.5', forwardedFor: null }, trusted)).toBe('10.0.0.5');
  });

  it('works for IPv6 proxies and clients', () => {
    expect(clientAddress({ peer: 'fd00::1', forwardedFor: '2001:db8::42' }, ['fd00::/8'])).toBe(
      '2001:db8::42',
    );
    expect(
      clientAddress({ peer: '::ffff:10.0.0.5', forwardedFor: '198.51.100.9' }, ['10.0.0.5']),
    ).toBe('198.51.100.9');
  });
});

describe('address ranges', () => {
  it('parses addresses and CIDR ranges, and refuses anything else', () => {
    expect(parseRange('10.0.0.5')).toMatchObject({ bits: 32, v6: false });
    expect(parseRange('10.0.0.0/8')).toMatchObject({ bits: 8 });
    expect(parseRange('::1')).toMatchObject({ bits: 128, v6: true });
    expect(parseRange('2001:db8::/32')).toMatchObject({ bits: 32, v6: true });
    for (const bad of ['10.0.0', '10.0.0.256', '10.0.0.0/33', 'example.test', '1::2::3', ''])
      expect(parseRange(bad)).toBeNull();
  });
});
