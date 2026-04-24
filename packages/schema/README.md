# @pulse/schema

Zod + Drizzle schema and DB helpers for Pulse.

## Scope

- **Active in the voice demo:** `tenants`, `menus`, tenant lookup helpers, migrations, and RLS setup.
- **Kept for continuity:** legacy extraction/insight tables remain in schema and migrations, but are not part of the current `/` voice demo flow.

## Commands

- `pnpm --filter @pulse/schema db:generate` — generate migration SQL from `src/db.ts`.
- `pnpm --filter @pulse/schema db:migrate` — apply migrations and RLS statements.
- `pnpm --filter @pulse/schema seed:voice` — seed `tonys-pizza-austin` tenant + menu.

## Notes

- Local Docker Postgres defaults to port `55432` (see `infra/docker-compose.yml`).
- Tenant isolation relies on RLS + `withTenant(...)`.
