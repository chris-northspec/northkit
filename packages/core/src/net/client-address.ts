import { withScope, sql, type Db } from '@northkit/db';
import { z } from 'zod';
import { requirePermission, scopeOf, type ActorContext } from '../context';
import { NotFoundError, ValidationError } from '../errors';

// Which address a request came from, for rate limits and the audit trail (D15). The
// connecting (socket) address is the truth unless an administrator has named the
// customer's own reverse proxy: only a request arriving from that proxy has its
// X-Forwarded-For believed, and then only up to the first hop that isn't a named
// proxy. Off by default: anyone can type an X-Forwarded-For header.

interface Parsed {
  v6: boolean;
  value: bigint;
}

function parseV4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let out = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    out = (out << 8n) | BigInt(p);
  }
  return out;
}

function parseV6(text: string): bigint | null {
  let head = text;
  let tail: bigint | null = null;
  // An IPv4 tail (::ffff:192.0.2.1) is the last two groups.
  const v4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    tail = parseV4(v4[2]!);
    if (tail === null) return null;
    head = `${v4[1]}0:0`;
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const left = groups(halves[0]!);
  const right = halves.length === 2 ? groups(halves[1]!) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
  let out = 0n;
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  if (tail !== null) out = (out & ~0xffffffffn) | tail;
  return out;
}

/** An address as a number; an IPv4-mapped IPv6 address (::ffff:a.b.c.d) counts as IPv4. */
export function parseAddress(text: string): Parsed | null {
  const t = text
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  if (t.includes(':')) {
    const v = parseV6(t);
    if (v === null) return null;
    if (v >> 32n === 0xffffn) return { v6: false, value: v & 0xffffffffn };
    return { v6: true, value: v };
  }
  const v = parseV4(t);
  return v === null ? null : { v6: false, value: v };
}

export interface AddressRange {
  v6: boolean;
  base: bigint;
  bits: number;
}

/** '192.0.2.10', '10.0.0.0/8' or 'fd00::/8'; null if it isn't one. */
export function parseRange(text: string): AddressRange | null {
  const [addr, len, extra] = text.trim().split('/');
  if (extra !== undefined || !addr) return null;
  const a = parseAddress(addr);
  if (!a) return null;
  const max = a.v6 ? 128 : 32;
  const bits = len === undefined ? max : /^\d{1,3}$/.test(len) ? Number(len) : -1;
  if (bits < 0 || bits > max) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
  return { v6: a.v6, base: a.value & mask, bits };
}

function inRange(address: Parsed, range: AddressRange): boolean {
  if (address.v6 !== range.v6) return false;
  const max = range.v6 ? 128 : 32;
  const mask =
    range.bits === 0 ? 0n : ((1n << BigInt(range.bits)) - 1n) << BigInt(max - range.bits);
  return (address.value & mask) === range.base;
}

function canonical(text: string): string | null {
  const t = text.trim().replace(/^\[|\]$/g, '');
  const p = parseAddress(t);
  if (!p) return null;
  // Show an IPv4-mapped address as plain IPv4, as the audit trail and limits expect.
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(t);
  return m ? m[1]! : t.replace(/%.*$/, '').toLowerCase();
}

export interface RequestAddresses {
  /** The connecting address from the socket. */
  peer: string | null;
  /** The raw X-Forwarded-For header, if any. */
  forwardedFor: string | null;
  /** Cloudflare's Cf-Connecting-Ip header, if any (the demo link's tunnel). */
  connectingIp?: string | null;
}

const LOOPBACK = ['127.0.0.0/8', '::1'];

/** True for 127.x.x.x and ::1 (including ::ffff:127.x.x.x). */
export function isLoopback(address: string): boolean {
  const p = parseAddress(address);
  return p !== null && LOOPBACK.map(parseRange).some((r) => r !== null && inRange(p, r));
}

/**
 * The client address to rate-limit and log. With no trusted proxies (the default) it is
 * the connecting address, whatever headers say. Behind a named proxy, X-Forwarded-For is
 * read from the right, skipping the named proxies, to the first address that isn't one;
 * anything a client put further left can't move it.
 */
export function clientAddress(
  request: RequestAddresses,
  trustedList: readonly string[],
  options: { trustLoopback?: boolean } = {},
): string | null {
  const peer = request.peer ? canonical(request.peer) : null;
  if (!peer) return null;
  // The demo link (docs/demo-link.md): a Cloudflare Tunnel on this machine connects from
  // loopback and names the visitor in Cf-Connecting-Ip. Only then is that header believed:
  // from anywhere else it is ignored, as anyone can type it.
  const fromTunnel = options.trustLoopback === true && isLoopback(peer);
  if (fromTunnel && request.connectingIp) {
    const visitor = canonical(request.connectingIp);
    if (visitor) return visitor;
  }
  const trusted = fromTunnel ? [...trustedList, ...LOOPBACK] : trustedList;
  const ranges = trusted.map(parseRange).filter((r): r is AddressRange => r !== null);
  const isTrusted = (a: string) => {
    const p = parseAddress(a);
    return p !== null && ranges.some((r) => inRange(p, r));
  };
  if (ranges.length === 0 || !isTrusted(peer) || !request.forwardedFor) return peer;
  const hops = request.forwardedFor.split(',').map((h) => h.trim());
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = canonical(hops[i]!);
    // A hop that isn't an address means the header was mangled: stop at what we know.
    if (!hop) return peer;
    if (!isTrusted(hop)) return hop;
  }
  return peer;
}

// ---------------------------------------------------------------- the setting

export const MAX_TRUSTED_PROXIES = 10;

export const trustedProxiesSchema = z
  .string()
  .max(1000, 'Use 1,000 characters or fewer.')
  .transform((text) =>
    text
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine(
    (list) => list.length <= MAX_TRUSTED_PROXIES,
    `Name up to ${MAX_TRUSTED_PROXIES} addresses.`,
  )
  .refine(
    (list) => list.every((s) => parseRange(s) !== null),
    'Use addresses like 10.0.0.5 or ranges like 10.0.0.0/24, separated by commas or spaces.',
  );

/** The named proxies, for every request: no permission needed, nothing personal. */
export async function trustedProxies(db: Db): Promise<string[]> {
  const { rows } = await sql<{ proxies: string[] }>`
    SELECT trusted_proxies::text[] AS proxies FROM core.organisations`.execute(db);
  return rows[0]?.proxies ?? [];
}

/** Administrators name the customer's reverse proxy (D15); blank switches it off. */
export async function setTrustedProxies(
  db: Db,
  actor: ActorContext,
  input: string,
): Promise<string[]> {
  requirePermission(actor, 'settings.edit');
  if (!actor.administrator)
    throw new ValidationError('Only an administrator can name the reverse proxy.');
  const parsed = trustedProxiesSchema.safeParse(input);
  if (!parsed.success)
    throw new ValidationError('Check the highlighted fields.', {
      trustedProxies: parsed.error.issues[0]?.message ?? 'Check the addresses.',
    });
  const list = parsed.data.map((s) => {
    const r = parseRange(s)!;
    return s.includes('/') ? s : `${s}/${r.v6 ? 128 : 32}`;
  });
  const result = await withScope(db, scopeOf(actor), (tx) =>
    sql`UPDATE core.organisations SET trusted_proxies = ${list}::cidr[]`.execute(tx),
  );
  if (!result.numAffectedRows) throw new NotFoundError('Set-up has not been done yet.');
  return trustedProxies(db);
}
