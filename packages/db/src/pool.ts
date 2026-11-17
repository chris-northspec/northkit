import pg from 'pg';
import { connectionSettings, type ConnectionSettings, type DbRole } from './config';

// int8 (bigint) comes back as a string by default. Our bigint columns hold counts
// that stay far below 2^53, so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// date (holidays, expiry dates) stays a 'YYYY-MM-DD' string: turning it into a JS
// Date at local midnight can move it a day in either direction.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// numeric (job line quantities, meter readings, floor areas, scores) stays the exact
// decimal string PostgreSQL sends, never a JS float: 0.29 x 50p must be 14.5p, not
// 14.499999999999998p. packages/core/src/decimal.ts does the arithmetic (S5-0b, as
// ClearRate found). Money itself is bigint pence.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value);
// cidr[] (the trusted proxies) as an array of strings, like text[].
// pg's typings list only the built-in scalar type ids, not array ones.
type TypeId = (typeof pg.types.builtins)[keyof typeof pg.types.builtins];
const CIDR_ARRAY_OID = 651 as unknown as TypeId;
const TEXT_ARRAY_OID = 1009 as unknown as TypeId;
const parseTextArray = pg.types.getTypeParser(TEXT_ARRAY_OID) as (value: string) => string[];
pg.types.setTypeParser(CIDR_ARRAY_OID, parseTextArray);

export function createPool(
  role: DbRole,
  overrides: Partial<ConnectionSettings> & { max?: number } = {},
): pg.Pool {
  const { max, ...rest } = overrides;
  const settings = connectionSettings(role, rest);
  return new pg.Pool({
    ...settings,
    max: max ?? 10,
    application_name: `northkit-${role}`,
    // Every timestamp is stored and compared in UTC; display code converts.
    options: '-c TimeZone=UTC',
  });
}
