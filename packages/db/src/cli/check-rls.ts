import { createPool } from '../pool';
import { findRlsProblems } from '../rls-check';
import { fail, say } from './output';

// pnpm db:check-rls — exits 1 if any site-owned table is unprotected (CI gate, S1-5).
const pool = createPool('admin', { max: 1 });
try {
  const problems = await findRlsProblems(pool);
  if (problems.length === 0) {
    say(
      'RLS check passed: every site-owned table has forced RLS, a site_isolation policy and a SELECT-only reporting policy; no product role can bypass RLS.',
    );
  } else {
    for (const { table, problems: found } of problems) say(`${table}: ${found.join('; ')}`);
    throw new Error(`RLS check failed: ${problems.length} unprotected table(s) or role(s).`);
  }
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
