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
 * passes on fresh clones without DB. CI sets DATABASE_URL to a Neon preview
 * branch and the skip turns off.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { calls, tenants, TENANT_SCOPED_TABLES } from '../src/db.js';
import { withTenant, withAdmin } from '../src/tenant.js';
import { RLS_INTROSPECT_SQL, allRlsStatements } from '../src/rls.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('RLS cross-tenant isolation', () => {
  const client = postgres(DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(client);

  let tenantA!: string;
  let tenantB!: string;

  beforeAll(async () => {
    // Apply RLS to be safe (idempotent).
    for (const stmt of allRlsStatements()) {
      await db.execute(sql.raw(stmt));
    }

    // Admin context inserts two tenants.
    await withAdmin(db, async (tx) => {
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

    // Seed one call into each tenant.
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
    // Tear down without RLS to clean up both tenants.
    await withAdmin(db, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantA));
      await tx.delete(tenants).where(eq(tenants.id, tenantB));
    });
    await client.end({ timeout: 5 });
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

  it('query without app.tenant_id returns 0 rows', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
      return tx.select().from(calls);
    });
    expect(rows.length).toBe(0);
  });

  it('tenant A cannot see tenant B calls', async () => {
    const rowsA = await withTenant(db, tenantA, async (tx) => tx.select().from(calls));
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.tenant_id === tenantA)).toBe(true);

    const rowsB = await withTenant(db, tenantB, async (tx) => tx.select().from(calls));
    expect(rowsB.length).toBeGreaterThan(0);
    expect(rowsB.every((r) => r.tenant_id === tenantB)).toBe(true);
  });

  it('INSERT with mismatched tenant_id fails WITH CHECK', async () => {
    await expect(
      withTenant(db, tenantA, async (tx) => {
        await tx.insert(calls).values({
          tenant_id: tenantB, // mismatched
          provider: 'upload',
          external_call_id: `rls-bad-${Date.now()}`,
          started_at: new Date(),
          ended_at: new Date(),
          duration_s: 1,
          raw_transcript: { turns: [] },
        });
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('RLS introspection SQL shape is stable', () => {
    expect(RLS_INTROSPECT_SQL).toContain('pg_policy');
    expect(RLS_INTROSPECT_SQL).toContain('pg_class');
  });
});
