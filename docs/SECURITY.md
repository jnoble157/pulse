# Security

Pulse can touch real phone audio and real API keys. Be boring about it.

## Threat model (short)

1. **Cross-tenant data** — Postgres **RLS** on tenant-scoped tables; `withTenant` / `withAdmin` set `app.tenant_id`. Do not disable RLS to debug; use `SET LOCAL app.tenant_id = '<uuid>'`.
2. **Secrets** — Never commit `.env*`. Rotate if leaked.
3. **Password gate** — `DEMO_PASSWORD` + `DEMO_COOKIE_SECRET` (Web Crypto HMAC in middleware). Misconfig → 503, not open.
4. **Live push** — `POST /api/calls/live/push` requires `Authorization: Bearer <LIVE_CALLS_PUSH_TOKEN>` when the token is set. Gate bypasses this path so the voice server can reach Next without a session cookie.
5. **Prompt injection** — Caller text is not system instructions. `apps/voice` keeps system prompt and user turns separate per `AGENTS.md`.

## RLS

Policies live in `packages/schema/src/rls.ts`, applied after `pnpm db:migrate`. CI can skip RLS tests in some environments; production must not.

## PII / retention

The **ingestion + redaction pipeline** that populated `redaction_maps` and guest graph is not in this repo anymore ([ADR-038](DECISIONS.md)). The **schema** still documents PII patterns for when/if that path returns.

For **this demo**: live calls are not durably stored by the shipped voice path; still do not log raw caller audio to public URLs.

## Voice / compliance

Before recording calls or deploying wide: two-party consent rules, retention policy, and whether you need a spoken consent line at greeting. Not implemented here.
