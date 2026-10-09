// Recrée une base de test locale : shim Supabase + migrations + seed.
// Usage : DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres node scripts/db-reset.mjs [--no-seed]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const dbName = process.env.TEST_DB_NAME ?? 'unimob_test';

export async function resetDatabase({ seed = true } = {}) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const run = async (file) => {
      try {
        await client.query(readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(`${file}: ${e.message}`);
      }
    };
    await run(join(root, 'tests/db/supabase-shim.sql'));
    const migDir = join(root, 'supabase/migrations');
    for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
      await run(join(migDir, f));
    }
    if (seed) await run(join(root, 'supabase/seed.sql'));
  } finally {
    await client.end();
  }
  return url.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  resetDatabase({ seed: !process.argv.includes('--no-seed') })
    .then((u) => console.log(`Base prête : ${u.replace(/:[^:@/]+@/, ':***@')}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
