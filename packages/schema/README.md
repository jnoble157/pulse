# @pulse/schema

Zod + Drizzle: models, migrations, RLS, DB helpers.

The voice agent needs tenant + menu (+ lookups from the same schema). `pnpm seed:voice` seeds the demo tenant. Other tables in `src/db.ts` exist for migrations already applied—only use what the apps import.

## Commands

- `pnpm --filter @pulse/schema db:generate` — generate migration SQL from `src/db.ts`.
- `pnpm --filter @pulse/schema db:migrate` — apply migrations and RLS statements.
- `pnpm --filter @pulse/schema seed:voice` — seed `tonys-pizza-austin` tenant + menu.

## Notes

- Local Docker Postgres defaults to port `55432` (see `infra/docker-compose.yml`).
- Tenant isolation relies on RLS + `withTenant(...)`.
