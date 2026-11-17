import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decimalInput,
  formatDecimal,
  linePence,
  penceToPounds,
  poundsToPence,
  roundDecimal,
  scaled,
  unscaled,
} from '../src/decimal';
import { fixtures, type Fixtures } from './fixtures';

// S5-0b: numeric columns are read exactly (as ClearRate found, NorthKeep read them as JS
// floats). Each case below is one floating point gets wrong.

describe('exact decimals', () => {
  it('works with values floating point gets wrong', () => {
    // 0.29 hours at 50p: 14.5p exactly, so 15p; as floats 14.499999999999998, so 14p.
    expect(Math.round(0.29 * 50)).toBe(14);
    expect(linePence('0.29', 50)).toBe(15);
    // 0.1 + 0.2 is 0.30000000000000004 as floats.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(unscaled(scaled('0.1', 2) + scaled('0.2', 2), 2)).toBe('0.30');
    // £1.005 isn't money (three places); £4.35 is 435p, never 434.99999999999994.
    expect(4.35 * 100).not.toBe(435);
    expect(poundsToPence('4.35')).toBe(435);
    expect(poundsToPence('1.005')).toBeNull();
    // Hundredths x pence passes 2^53 at the column limits; BigInt inside keeps it exact.
    expect(linePence('99999.99', 9_999_999_999)).toBe(999_999_899_900_000);
    expect(linePence('100000', 10_000_000_000)).toBe(1_000_000_000_000_000);
  });

  it('scales, unscales and rounds half up', () => {
    expect(scaled('12.5', 2)).toBe(1250);
    expect(scaled('-0.05', 2)).toBe(-5);
    expect(scaled(7, 3)).toBe(7000);
    expect(() => scaled('1.234', 2)).toThrow(/more than 2/);
    expect(() => scaled(1.5, 2)).toThrow(/strings/);
    expect(unscaled(5, 2)).toBe('0.05');
    expect(unscaled(-1250, 2)).toBe('-12.50');
    expect(roundDecimal('2.0005', 3)).toBe('2.001');
    expect(roundDecimal('2.0004', 3)).toBe('2.000');
    expect(roundDecimal('-1.25', 1)).toBe('-1.3');
    expect(roundDecimal('abc', 1)).toBeNull();
    expect(linePence('0.5', 1)).toBe(1);
    expect(linePence('0.49', 1)).toBe(0);
  });

  it('reads what people type, and shows it back', () => {
    expect(decimalInput(' 1,200.50 ', 2)).toBe('1200.50');
    expect(decimalInput('3', 2)).toBe('3.00');
    expect(decimalInput('1.250', 2)).toBe('1.25');
    expect(decimalInput('1.255', 2)).toBeNull();
    expect(decimalInput('1e3', 2)).toBeNull();
    expect(poundsToPence('£12,500')).toBe(1_250_000);
    expect(penceToPounds(1_250_005)).toBe('12500.05');
    expect(formatDecimal('12345.50')).toBe('12,345.5');
    expect(formatDecimal('-3.00')).toBe('-3');
  });
});

describe('numeric columns', () => {
  let f: Fixtures;
  beforeAll(() => {
    f = fixtures();
  });
  afterAll(async () => {
    await f.close();
  });

  it('the pool reads numeric as the exact string PostgreSQL sends', async () => {
    const { rows } = await f.admin.query<{ n: unknown }>(`SELECT 0.1::numeric + 0.2::numeric AS n`);
    expect(rows[0]!.n).toBe('0.3');
  });
});
