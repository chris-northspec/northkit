import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientAddress } from '@northkit/core';
import { PEER_HEADER } from '../server/peer-address.mjs';

// S3-10 (D15) end to end at the HTTP layer: the preload records the socket address and
// a client can't forge it, so spoofed X-Forwarded-For only counts behind a named proxy.

let server: http.Server;
let port: number;
const seen: Record<string, string | undefined>[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      peer: req.headers[PEER_HEADER] as string,
      xff: req.headers['x-forwarded-for'] as string,
    });
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function get(headers: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
        res.resume();
        res.on('end', resolve);
      })
      .on('error', reject);
  });
}

describe('connecting address preload', () => {
  it('replaces a forged peer header with the socket address', async () => {
    await get({ [PEER_HEADER]: '198.51.100.1', 'X-Forwarded-For': '198.51.100.2' });
    const last = seen.at(-1)!;
    expect(last.peer).toBe('127.0.0.1');
    // Setting off: the spoofed X-Forwarded-For is ignored.
    expect(clientAddress({ peer: last.peer ?? null, forwardedFor: last.xff ?? null }, [])).toBe(
      '127.0.0.1',
    );
    // Setting on, naming this proxy: the forwarded address is believed.
    expect(
      clientAddress({ peer: last.peer ?? null, forwardedFor: last.xff ?? null }, ['127.0.0.1']),
    ).toBe('198.51.100.2');
    // Setting on, naming another proxy: still ignored.
    expect(
      clientAddress({ peer: last.peer ?? null, forwardedFor: last.xff ?? null }, ['10.0.0.5']),
    ).toBe('127.0.0.1');
  });
});
