# Architecture

Pulse today is a **password-gated Next.js page** plus a **separate Node voice server**. There is no analytics pipeline in-tree; that code was removed with [ADR-038](DECISIONS.md#adr-038--pivot-to-a-voice-agent-demo-remove-the-analytics-surface).

## Runtime

```
Caller ─ PSTN ─ Twilio ─ POST /twilio/voice (TwiML) ─ WS /twilio/media
                                                          │
                                               apps/voice (Hono)
                                                          │
                                    Deepgram STT → Claude (tools) → ElevenLabs TTS
                                                          │
                                    LivePushClient ──► POST apps/web/api/calls/live/push
                                                          │
                                    Browser ◄── GET apps/web/api/calls/live (SSE)
                                                          │
                                               CallStage (transcript + samples)
```

**Sample calls:** `POST /api/calls/example` reads `public/example-calls/<scenario>.json`, emits the same event shape into the in-memory store, returns `audio_url` for the `<audio>` element. Same SSE path as Twilio.

## In-memory pub/sub

`apps/web/lib/live-calls.ts` holds active calls. **Single process:** one Next server (or one Vercel region). No Redis. Multi-region later means replacing the store or adding sticky routing.

## Postgres

`packages/schema` + `infra/drizzle` migrations. The voice process loads **tenant + menu** via `DATABASE_URL` and `PULSE_TENANT_SLUG` (`pnpm seed:voice` creates rows without synthetic calls).

Other tables (`calls`, `call_extractions`, …) remain in the schema for continuity if analytics is revived from git; the voice agent does not write them today.

## Security boundary

Tenant-scoped data still uses **RLS** (`app.tenant_id`). Voice boot uses `withAdmin` for the menu read. See `docs/SECURITY.md`.

## Key paths

| Path | Role |
| --- | --- |
| `apps/web/app/page.tsx` | Hero + `CallStage` |
| `apps/web/components/voice/CallStage.tsx` | SSE + UI |
| `apps/web/lib/live-calls.ts` | Event bus |
| `apps/voice/src/server.ts` | HTTP + WS |
| `apps/voice/src/orchestrator.ts` | Per-call state machine |
| `apps/voice/src/live-push.ts` | POST events to web |
