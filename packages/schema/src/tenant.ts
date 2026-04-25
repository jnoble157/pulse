/**
 * withTenant: binds `app.tenant_id` for the duration of a callback.
 *
 * Per AGENTS.md §Hard invariants #4 and README § Security, every DB query must
 * run with `app.tenant_id` set so RLS can enforce isolation. We use
 * `SET LOCAL` inside a transaction so pooled connections don't leak.
 *
 * Usage:
 *   await withTenant(db, tenantId, async (tx) => {
 *     return tx.select().from(calls).where(eq(calls.status, 'extracted'));
 *   });
 *
 * Cross-tenant paths (admin metrics, billing aggregation) live in a
 * separate paths and must not use this helper — they use withAdmin().
 */
import { sql } from 'drizzle-orm';

/**
 * A type that matches any Drizzle client with a `.transaction(cb)` method.
 * Declared generically so the caller keeps their own schema-parameterized
 * transaction type (`.insert(tenants).values({...})` stays correctly typed).
 */
type TxOf<TDb> = TDb extends {
  transaction: (cb: (tx: infer TTx) => Promise<unknown>) => Promise<unknown>;
}
  ? TTx
  : never;

type DbLike = {
  transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
};

/**
 * Runs `fn` in a DB transaction with `SET LOCAL app.tenant_id = ${tenantId}`.
 * The session variable is discarded on commit/rollback, so pooled connections
 * don't retain tenant context between requests.
 */
export async function withTenant<TDb extends DbLike, T>(
  db: TDb,
  tenantId: string,
  fn: (tx: TxOf<TDb>) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new Error(`withTenant: tenantId must be a uuid, got ${JSON.stringify(tenantId)}`);
  }
  return db.transaction(async (tx) => {
    const tTx = tx as TxOf<TDb>;
    await (tTx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tTx);
  });
}

/**
 * Admin/service-role path. Explicitly clears `app.tenant_id` so RLS returns
 * zero rows on tenant-scoped tables — admin queries must explicitly annotate
 * and test cross-tenant access.
 *
 * AGENTS.md §Hard invariants #4: cross-tenant access needs
 * `// CROSS-TENANT: reason` comments + tests.
 */
export async function withAdmin<TDb extends DbLike, T>(
  db: TDb,
  fn: (tx: TxOf<TDb>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const tTx = tx as TxOf<TDb>;
    await (tTx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`SELECT set_config('app.tenant_id', '', true)`,
    );
    return fn(tTx);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);
