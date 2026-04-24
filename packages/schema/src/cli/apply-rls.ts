#!/usr/bin/env tsx
/**
 * Apply RLS policies without running migrations. Useful after a manual
 * schema edit or when setting up a shadow database for tests.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { allRlsStatements } from '../rls.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function main() {
  const client = postgres(url!, { max: 1, prepare: false });
  const db = drizzle(client);
  for (const stmt of allRlsStatements()) {
    await db.execute(sql.raw(stmt));
  }
  await client.end({ timeout: 5 });
  console.info(`[rls] applied ${allRlsStatements().length} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
