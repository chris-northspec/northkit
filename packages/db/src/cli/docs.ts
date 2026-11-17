import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readDictionary, renderDictionary } from '../data-dictionary';
import { createPool } from '../pool';
import { fail, say } from './output';

// pnpm db:docs — writes docs/data-dictionary from the database's COMMENTs and
// exits 1 if any schema, table or column has none (DB-14). Run after db:migrate.
const outDir = path.join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'data-dictionary');
const pool = createPool('admin', { max: 1 });
try {
  const dictionary = await readDictionary(pool);
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.md')) rmSync(path.join(outDir, file));
  }
  const files = renderDictionary(dictionary);
  for (const [name, content] of files) writeFileSync(path.join(outDir, name), content);
  say(`wrote ${files.size} files to docs/data-dictionary (${dictionary.tables.length} tables)`);
  if (dictionary.missing.length > 0) {
    for (const item of dictionary.missing) say(`missing COMMENT: ${item}`);
    throw new Error(`${dictionary.missing.length} object(s) have no COMMENT (DB-14).`);
  }
} catch (error) {
  fail(error);
} finally {
  await pool.end();
}
