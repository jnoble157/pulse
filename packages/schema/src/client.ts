/**
 * Shared Drizzle client factory. Everything DB-touching imports from here.
 *
 * Uses postgres-js (fast, zero-dep, works in Node + Bun). For Neon in prod,
 * swap to @neondatabase/serverless without changing call sites — the driver
 * detail stays behind this factory.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './db.js';

export type Db = ReturnType<typeof makeDb>;

export function makeDb(url: string, opts: { max?: number; debug?: boolean } = {}) {
  const client = postgres(url, {
    max: opts.max ?? 10,
    prepare: false, // required for Neon pooler; cheap otherwise
    debug: opts.debug ? (_, q) => console.info('[sql]', q) : undefined,
  });
  return drizzle(client, { schema, logger: opts.debug ?? false });
}

export { schema };
