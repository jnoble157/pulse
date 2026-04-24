/**
 * RLS policy SQL for every tenant-scoped table.
 *
 * Generated from db.ts#TENANT_SCOPED_TABLES. Applied via src/cli/apply-rls.ts
 * after Drizzle migrations — keeping RLS outside Drizzle's migration diffing
 * because policies aren't table-shape changes.
 *
 * The `tenants` table uses `id` rather than `tenant_id` as the isolation key.
 */
import { TENANT_SCOPED_TABLES } from './db.js';

/** Column used by the RLS USING clause for the given table. */
export const tenantColumnFor = (table: string): string =>
  table === 'tenants' ? 'id' : 'tenant_id';

/** SQL statements to enable + force RLS + create the isolation policy. */
export function rlsStatementsFor(table: string): string[] {
  const col = tenantColumnFor(table);
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS tenant_isolation ON "${table}"`,
    `CREATE POLICY tenant_isolation ON "${table}"
       USING (${col} = current_setting('app.tenant_id', true)::uuid)
       WITH CHECK (${col} = current_setting('app.tenant_id', true)::uuid)`,
  ];
}

export function allRlsStatements(): string[] {
  return TENANT_SCOPED_TABLES.flatMap(rlsStatementsFor);
}

/**
 * Introspection SQL used by tests to assert every tenant-scoped table has a
 * policy. Returns (table, policy_count).
 */
export const RLS_INTROSPECT_SQL = `
  SELECT c.relname AS table, COUNT(p.polname) AS policy_count
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE c.relname = ANY($1)
  GROUP BY c.relname
  ORDER BY c.relname
`;
