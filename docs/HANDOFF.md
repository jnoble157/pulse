# HANDOFF

The front door is a **live voice demo**: sample-call buttons plus a Twilio number, with transcript lines streaming over SSE (`/api/calls/live`). The voice agent (`apps/voice/`) pushes turns to `POST /api/calls/live/push` when `LIVE_CALLS_PUSH_TOKEN` is set.

There is **no dependency on seeded synthetic calls** for this path. Postgres only needs a tenant row plus menu so the agent can resolve context at boot: run `pnpm seed:voice` after `pnpm db:migrate`.

Read [ADR-038](DECISIONS.md#adr-038--pivot-to-a-voice-agent-demo-remove-the-analytics-surface) for why the old analytics-first surface was removed from the product story.

## Read order

1. [`AGENTS.md`](../AGENTS.md) — operating manual; live-call transport rules matter most.
2. [`README.md`](../README.md) — how to run web + voice locally.
3. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — transcript push architecture.
4. [`docs/DECISIONS.md`](DECISIONS.md) — ADR-038.
5. [`apps/voice/README.md`](../apps/voice/README.md) — Twilio + env before changing the agent.

## Ground rules

- AGENTS.md is the operating manual.
- `packages/schema` is the source of truth for DB types.
- LLM calls in `apps/voice/` go through `@pulse/telemetry` as documented in AGENTS.md.
- Do not add a parallel transport beside `LivePushClient` for homepage transcript updates.

## Running it locally

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm seed:voice              # tenant + menu, no calls
pnpm example-calls:build     # once: writes order.mp3 + allergy.mp3 for the sample buttons
pnpm dev                     # Next :3000 + voice :8788
```

Use `pnpm dev:web` or `pnpm dev:voice` from the repo root if you want only one process.

For **live transcript while someone dials Twilio**, set the same `LIVE_CALLS_PUSH_TOKEN` in `.env` for both apps, point `PUBLIC_BASE_URL` at your voice server's public URL, and set `WEB_BASE_URL` to the Next origin (usually `http://127.0.0.1:3000` locally).

For a **deployed demo** with a number anyone can dial, deploy `apps/voice/` to Railway — see [`apps/voice/README.md` § Deploy to Railway in 5 minutes](../apps/voice/README.md#deploy-to-railway-in-5-minutes). Railway gives the voice service a stable `https://` URL Twilio can hit (with WebSocket support), so you set the Twilio webhook once instead of every ngrok restart.

## What not to touch

- The schema in `packages/schema/` without a migration in the same PR.
- RLS policies without following SECURITY.md.

## Tone

Plain language in UI copy and errors. One ADR per material direction shift.

The next person on this: read ADR-038, README, then `apps/voice/README.md` before changing the agent or the live-call API.
