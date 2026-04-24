# HANDOFF

The front door is a **live voice demo**: sample-call buttons plus a Twilio number, with transcript lines streaming over SSE (`/api/calls/live`). The voice agent (`apps/voice/`) pushes turns to `POST /api/calls/live/push` when `LIVE_CALLS_PUSH_TOKEN` is set.

There is **no dependency on seeded synthetic calls** for this path. Postgres only needs a tenant row plus menu so the agent can resolve context at boot: run `pnpm seed:voice` after `pnpm db:migrate`.

Read [ADR-038](DECISIONS.md#adr-038--pivot-to-a-voice-agent-demo-remove-the-analytics-surface) for why the old analytics-first surface was removed from the product story.

## Read order

1. [`AGENTS.md`](../AGENTS.md) — operating manual; live-call transport rules matter most.
2. **This file, §PSTN outbound audio** — known production gap (Apr 2026).
3. [`README.md`](../README.md) — how to run web + voice locally.
4. [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — transcript push architecture.
5. [`docs/DECISIONS.md`](DECISIONS.md) — ADR-038.
6. [`apps/voice/README.md`](../apps/voice/README.md) — Twilio + env + debugging checklist.

## PSTN outbound audio (open issue — Apr 2026)

**Symptom:** Twilio calls connect (`POST /twilio/voice` 200, `GET /twilio/media` stays up tens of seconds with HTTP status `0` = WebSocket). The **homepage transcript** updates (greeting + decide loop + live-push). The **caller hears silence** on the handset.

**What already works**

- Inbound audio → Deepgram → `decide()` → `speak()` path (transcript proves STT + LLM + push).
- `streamSid` is taken from `frame.streamSid || frame.start.streamSid` so the opening `greet()` is not skipped.
- Anthropic tool `input_schema` is a **flat** `z.object` + `superRefine` in `apps/voice/src/brain/tools.ts` (no top-level `anyOf`/`oneOf` — Anthropic rejects those).
- Live-push **ordering**: parallel `fetch` to Vercel could deliver `turn.appended` before `call.started`; `apps/web/lib/live-calls.ts` and `CallStage.tsx` buffer orphan turns and merge.
- Interim **barge-in** is suppressed until `greet()`’s `speak()` finishes so the caller does not cancel the greeting TTS.
- ElevenLabs stream-input: `auto_mode=true`, `pcm_16000`, deferred `{ "text": "" }` EOS; outbound μ-law is **chunked to 160-byte frames** before `twilioWs.send(makeMediaFrame(…))`.

**What is still broken**

- Something in **ElevenLabs → downsample → μ-law → Twilio `media` JSON** does not produce audible PSTN audio in production (Railway), despite `[voice] spoke …` log lines when TTS completes.

**Suggested next steps (in order)**

1. **Prove ElevenLabs returns audio:** In `apps/voice/src/audio/elevenlabs.ts`, log (once per turn) the first message that is not valid JSON, any JSON with an `error` / `message` field, and the **byte length** of the first decoded `audio` chunk. If length is always 0, the bug is upstream of Twilio.
2. **Prove Twilio accepts sends:** In `orchestrator.ts` `speak` `onChunk`, count frames and log `twilioWs.readyState` after open; wrap `send` and log failures (partially done).
3. **A/B formats:** Try ElevenLabs `ulaw_8000` again **without** our encoder (pass base64 straight to Twilio), or HTTP non-streaming TTS for one greeting to isolate WS vs codec.
4. **Twilio debugger:** Compare Programmable Voice **debugger / packet capture** with a minimal reference TwiML that uses `<Say>` — confirms PSTN path works independent of Media Streams.
5. **`latency_samples` in `call_summary`:** Stays `0` on greeting-only turns by design (`onFirstChunk` only records when `callerFinalAt` is set). Do **not** use it as proof of missing TTS.

## CI / `pnpm check`

`turbo run test` includes `packages/schema/tests/rls.test.ts`, which needs a reachable Postgres (`DATABASE_URL`, often `docker compose` from `infra/docker-compose.yml`). If RLS tests fail with `ECONNREFUSED`, start the DB or run `pnpm check` in CI where the database is provisioned.

## Recent churn (for blame / archaeology)

Commits around **2026-04-24** on `main`: ElevenLabs buffering/EOS, `streamSid` fallback, Anthropic schema fixes, live-call store race, μ-law chunking, Prettier on `llm.test.ts`. The **silence** issue was **not** resolved by those passes.

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

The next person on this: read **§PSTN outbound audio** above, ADR-038, README, then `apps/voice/README.md` before changing the agent or the live-call API.
