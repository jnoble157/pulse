#!/usr/bin/env tsx
/**
 * `pnpm db:migrate` — run Drizzle migrations, then apply RLS policies.
 *
 * RLS is applied after migrations so policies survive schema changes.
 * See SECURITY.md §3 for the invariant we're enforcing.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { allRlsStatements } from '../rls.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../../../infra/drizzle');

async function main() {
  const client = postgres(url!, { max: 1, prepare: false });
  const db = drizzle(client);

  console.info('[migrate] ensuring pgvector extension…');
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  console.info('[migrate] running drizzle migrations…');
  await migrate(db, { migrationsFolder });

  console.info('[migrate] applying RLS policies…');
  for (const stmt of allRlsStatements()) {
    await db.execute(sql.raw(stmt));
  }

  await client.end({ timeout: 5 });
  console.info('[migrate] done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
