/**
 * Cross-tenant isolation smoke tests.
 *
 * Enforces AGENTS.md §Hard invariants #3 and SECURITY.md §3:
 *   - every tenant-scoped table has an active policy (introspection)
 *   - query without `app.tenant_id` set → 0 rows
 *   - query with tenant A → only tenant A rows
 *   - INSERT with mismatched tenant_id fails via RLS WITH CHECK
 *
 * These tests skip gracefully when DATABASE_URL is absent, so `pnpm check`
 * passes on fresh clones without DB.
 *
 * Isolation assertions need a **non-superuser** connection: the default
 * `postgres` role in local/CI images is a superuser and does not evaluate RLS
 * the same way as app roles. CI sets `DATABASE_URL` to `pulse_ci` and
 * `RLS_ADMIN_DATABASE_URL` to `postgres` for setup/teardown. When both URLs are
 * absent or equal, strict isolation tests are skipped (see `it.skipIf` below).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { calls, tenants, TENANT_SCOPED_TABLES } from '../src/db.js';
import { withTenant, withAdmin } from '../src/tenant.js';
import { RLS_INTROSPECT_SQL, allRlsStatements } from '../src/rls.js';

const DATABASE_URL = process.env.DATABASE_URL;
const RLS_ADMIN_DATABASE_URL = process.env.RLS_ADMIN_DATABASE_URL;

/** App-style role for RLS assertions + superuser (or owner) for admin DDL/DML. */
const strictRls =
  Boolean(DATABASE_URL && RLS_ADMIN_DATABASE_URL) && RLS_ADMIN_DATABASE_URL !== DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('RLS cross-tenant isolation', () => {
  const adminUrl = strictRls ? RLS_ADMIN_DATABASE_URL! : DATABASE_URL!;
  const tenantUrl = DATABASE_URL!;

  const adminClient = postgres(adminUrl, { max: 1, prepare: false });
  const tenantClient =
    strictRls && tenantUrl !== adminUrl
      ? postgres(tenantUrl, { max: 1, prepare: false })
      : adminClient;

  const adminDb = drizzle(adminClient);
  const db = strictRls ? drizzle(tenantClient) : adminDb;

  let tenantA!: string;
  let tenantB!: string;

  beforeAll(async () => {
    // Apply RLS as table owner (idempotent).
    for (const stmt of allRlsStatements()) {
      await adminDb.execute(sql.raw(stmt));
    }

    if (strictRls) {
      await adminDb.transaction(async (tx) => {
        await tx.execute(sql.raw('SET LOCAL row_security = off'));
        await tx.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
        const [a] = await tx
          .insert(tenants)
          .values({ slug: `rls-test-a-${Date.now()}`, name: 'RLS Test A' })
          .returning({ id: tenants.id });
        const [b] = await tx
          .insert(tenants)
          .values({ slug: `rls-test-b-${Date.now()}`, name: 'RLS Test B' })
          .returning({ id: tenants.id });
        tenantA = a!.id;
        tenantB = b!.id;
      });
    } else {
      await withAdmin(adminDb, async (tx) => {
        const [a] = await tx
          .insert(tenants)
          .values({ slug: `rls-test-a-${Date.now()}`, name: 'RLS Test A' })
          .returning({ id: tenants.id });
        const [b] = await tx
          .insert(tenants)
          .values({ slug: `rls-test-b-${Date.now()}`, name: 'RLS Test B' })
          .returning({ id: tenants.id });
        tenantA = a!.id;
        tenantB = b!.id;
      });
    }

    // Seed one call into each tenant (must use tenant-scoped connection).
    await withTenant(db, tenantA, async (tx) => {
      await tx.insert(calls).values({
        tenant_id: tenantA,
        provider: 'upload',
        external_call_id: `rls-a-${Date.now()}`,
        started_at: new Date(),
        ended_at: new Date(),
        duration_s: 42,
        raw_transcript: { turns: [] },
      });
    });

    await withTenant(db, tenantB, async (tx) => {
      await tx.insert(calls).values({
        tenant_id: tenantB,
        provider: 'upload',
        external_call_id: `rls-b-${Date.now()}`,
        started_at: new Date(),
        ended_at: new Date(),
        duration_s: 42,
        raw_transcript: { turns: [] },
      });
    });
  });

  afterAll(async () => {
    if (strictRls) {
      await adminDb.transaction(async (tx) => {
        await tx.execute(sql.raw('SET LOCAL row_security = off'));
        await tx.execute(
          sql.raw(`DELETE FROM calls WHERE tenant_id IN ('${tenantA}'::uuid, '${tenantB}'::uuid)`),
        );
        await tx.execute(
          sql.raw(`DELETE FROM tenants WHERE id IN ('${tenantA}'::uuid, '${tenantB}'::uuid)`),
        );
      });
    } else {
      await withAdmin(adminDb, async (tx) => {
        await tx.delete(tenants).where(eq(tenants.id, tenantA));
        await tx.delete(tenants).where(eq(tenants.id, tenantB));
      });
    }
    await tenantClient.end({ timeout: 5 });
    if (tenantClient !== adminClient) {
      await adminClient.end({ timeout: 5 });
    }
  });

  it('every tenant-scoped table has an RLS policy', async () => {
    const rows = await db.execute(
      sql.raw(
        `SELECT c.relname AS table, COUNT(p.polname) AS policy_count
       FROM pg_class c
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relname = ANY(ARRAY[${TENANT_SCOPED_TABLES.map((t) => `'${t}'`).join(',')}])
       GROUP BY c.relname
       ORDER BY c.relname`,
      ),
    );
    const rs = rows as unknown as Array<{ table: string; policy_count: number | string }>;
    const missing = rs.filter((r) => Number(r.policy_count) < 1).map((r) => r.table);
    expect(missing, `tables missing RLS: ${missing.join(', ')}`).toEqual([]);
    expect(rs.length).toBe(TENANT_SCOPED_TABLES.length);
  });

  it.skipIf(!strictRls)('query without app.tenant_id returns 0 rows', async () => {
    // Use a brand-new session: postgres.js may leave session-level GUCs on the
    // shared `tenantClient` (e.g. from driver or prior statements), and
    // `withTenant` only guarantees `SET LOCAL` for its own transaction window.
    const freshClient = postgres(tenantUrl, { max: 1, prepare: false });
    const freshDb = drizzle(freshClient);
    try {
      const rows = await freshDb.transaction(async (tx) => tx.select().from(calls));
      expect(rows.length).toBe(0);
    } finally {
      await freshClient.end({ timeout: 5 });
    }
  });

  it.skipIf(!strictRls)('tenant A cannot see tenant B calls', async () => {
    const rowsA = await withTenant(db, tenantA, async (tx) => tx.select().from(calls));
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.tenant_id === tenantA)).toBe(true);

    const rowsB = await withTenant(db, tenantB, async (tx) => tx.select().from(calls));
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsB.every((r) => r.tenant_id === tenantB)).toBe(true);
  });

  it.skipIf(!strictRls)('INSERT with mismatched tenant_id fails WITH CHECK', async () => {
    try {
      await withTenant(db, tenantA, async (tx) => {
        await tx.insert(calls).values({
          tenant_id: tenantB, // mismatched
          provider: 'upload',
          external_call_id: `rls-bad-${Date.now()}`,
          started_at: new Date(),
          ended_at: new Date(),
          duration_s: 1,
          raw_transcript: { turns: [] },
        });
      });
      expect.fail('expected RLS WITH CHECK to reject mismatched tenant_id');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Wording varies by Postgres version and driver (postgres.js wraps PG text).
      expect(msg).toMatch(
        /row-level security|violat(es|ing).*policy|\bRLS\b|policy.*check|42501|permission denied for table/i,
      );
    }
  });

  it('RLS introspection SQL shape is stable', () => {
    expect(RLS_INTROSPECT_SQL).toContain('pg_policy');
    expect(RLS_INTROSPECT_SQL).toContain('pg_class');
  });
});
