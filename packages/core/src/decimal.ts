// Exact decimals (S5-0b). PostgreSQL `numeric` values arrive as the exact decimal string
// it sends (packages/db/src/pool.ts) and money is whole pence. Arithmetic is done on
// whole numbers scaled by a power of ten, never on JS floats: 0.29 hours at 50p is 14.5p,
// which rounds to 15p, where floating point makes it 14.499999999999998p and 14p.

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * A decimal string (or a whole number) as a whole number of 1/10^scale units:
 * scaled('12.5', 2) is 1250. Throws if it has more decimal places than `scale` or is
 * too big to be exact. For values read from the database, whose scale the column fixes.
 */
export function scaled(value: string | number, scale: number): number {
  const text = typeof value === 'number' ? wholeOrThrow(value) : value.trim();
  const m = DECIMAL.exec(text);
  if (!m) throw new RangeError(`Not a decimal: ${JSON.stringify(value)}`);
  const [, minus, whole, fraction = ''] = m;
  const extra = fraction.slice(scale);
  if (/[^0]/.test(extra)) throw new RangeError(`${text} has more than ${scale} decimal places.`);
  const digits = whole! + fraction.slice(0, scale).padEnd(scale, '0');
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${text} is too large to be exact.`);
  return minus && n !== 0 ? -n : n;
}

function wholeOrThrow(n: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Pass decimals as strings, not ${n}.`);
  return String(n);
}

/**
 * A decimal string rounded half up (away from zero) to `scale` places, exactly, as a
 * numeric(p, scale) column stores it: roundDecimal('2.0005', 3) is '2.001'. Null if it
 * isn't a decimal.
 */
export function roundDecimal(value: string, scale: number): string | null {
  const m = DECIMAL.exec(value.trim());
  if (!m) return null;
  const [, minus, whole, fraction = ''] = m;
  const kept = BigInt(whole! + fraction.slice(0, scale).padEnd(scale, '0'));
  const up = (fraction[scale] ?? '0') >= '5' ? 1n : 0n;
  const n = kept + up;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return unscaled(minus && n !== 0n ? -Number(n) : Number(n), scale);
}

/** The decimal string for a scaled whole number: unscaled(1250, 2) is '12.50'. */
export function unscaled(n: number, scale: number): string {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Not a whole number: ${n}`);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).padStart(scale + 1, '0');
  if (scale === 0) return sign + digits;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** A decimal string without trailing zeros, for people: '12.50' is '12.5', '3.00' is '3'. */
export function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** A decimal for people, UK style with thousands separators: '12345.50' is '12,345.5'. */
export function formatDecimal(value: string): string {
  const [whole, fraction] = trimDecimal(value).split('.');
  const sign = whole!.startsWith('-') ? '-' : '';
  const digits = whole!.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${digits}${fraction ? `.${fraction}` : ''}`;
}

/**
 * What someone typed, checked as a decimal with at most `scale` places (commas as
 * thousands separators allowed), returned as a plain decimal string; null if it isn't
 * one. Exact: nothing passes through a float.
 */
export function decimalInput(text: string, scale: number): string | null {
  const t = text.trim().replace(/,(?=\d{3}(\D|$))/g, '');
  const m = DECIMAL.exec(t);
  if (!m) return null;
  const fraction = m[3] ?? '';
  if (fraction.length > scale && /[^0]/.test(fraction.slice(scale))) return null;
  try {
    return unscaled(scaled(t, scale), scale);
  } catch {
    return null;
  }
}

/** Pounds as typed ('4.35', '£1,200') to whole pence, exactly; null if it isn't money. */
export function poundsToPence(text: string): number | null {
  const amount = decimalInput(text.replace(/^£/, '').trim(), 2);
  return amount === null ? null : scaled(amount, 2);
}

/** Whole pence as pounds for a form field: 123456 is '1234.56'. */
export function penceToPounds(pence: number): string {
  return unscaled(pence, 2);
}

/**
 * The cost in whole pence of `quantity` (a decimal with up to 2 places, e.g. hours) at
 * `unitPence` each, rounded half up once for the line. BigInt inside, so it is exact
 * even where quantity x price passes 2^53.
 */
export function linePence(quantity: string, unitPence: number): number {
  if (!Number.isSafeInteger(unitPence) || unitPence < 0)
    throw new RangeError(`Not whole pence: ${unitPence}`);
  const hundredths = BigInt(scaled(quantity, 2));
  const product = hundredths * BigInt(unitPence);
  const rounded = (product + (product < 0n ? -50n : 50n)) / 100n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('That line is too large.');
  return Number(rounded);
}
