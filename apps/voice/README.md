# @pulse/voice

Live Twilio agent: Deepgram STT → Claude (structured turn) → ElevenLabs TTS. Caller and agent lines POST to Next (`/api/calls/live/push`) when `LIVE_CALLS_PUSH_TOKEN` and `WEB_BASE_URL` are set so the homepage transcript stays in sync.

Tenant + menu load from Postgres at boot (`DATABASE_URL` + `PULSE_TENANT_SLUG`). From repo root: `pnpm seed:voice` if you only need menu rows.

## Architecture

```
caller ── PSTN ── Twilio ── WS /twilio/media ── Orchestrator
                                                  │
                    Deepgram (final) ────────────┤
                    decide() / tools ────────────┤
                    ElevenLabs TTS ──────────────┘
                              │
                    LivePushClient → POST WEB_BASE_URL/api/calls/live/push
```

## Env

| Key                         | Why |
| --------------------------- | --- |
| `PORT`                      | HTTP + WS (default 8788). |
| `PUBLIC_BASE_URL`         | Origin Twilio hits for `/twilio/voice` + `wss://…/twilio/media`. Default `http://127.0.0.1:8788`; use ngrok or Railway URL for PSTN. |
| `WEB_BASE_URL`              | Next origin for transcript push. Default `http://127.0.0.1:3000`. |
| `LIVE_CALLS_PUSH_TOKEN`     | Same bearer as web. Optional locally; required in prod. |
| `ANTHROPIC_API_KEY`         | Claude per-turn. |
| `DEEPGRAM_API_KEY`          | Streaming STT. |
| `ELEVENLABS_API_KEY`        | Streaming TTS + `pnpm example-calls:build`. |
| `ELEVENLABS_VOICE_ID`       | Voice id for the agent. |
| `ELEVENLABS_MODEL`          | Default `eleven_flash_v2_5`. |
| `TWILIO_AUTH_TOKEN`         | Required in production for `X-Twilio-Signature` on `/twilio/voice`. |
| `PULSE_TENANT_SLUG`         | Default `tonys-pizza-austin`. |
| `DATABASE_URL`              | Tenant + menu at boot. |
| `AGENT_MODEL`               | `claude-haiku-4-5` (default) or `claude-sonnet-4-5`. |

**ElevenLabs (billing / licensing):** Free tier includes a monthly credit pool (check ElevenLabs for current numbers)—enough for light personal demos if calls are short and rare. Free tier does not grant commercial redistribution of generated speech; public or company-facing demos usually need **Starter** or higher. Long calls burn credits fast. If a voice id or endpoint returns 403, switch voice or upgrade.

## Local development

From repo root (loads root `.env`):

```bash
pnpm db:migrate && pnpm seed:voice
pnpm dev                    # or: pnpm dev:voice
```

Twilio cannot reach `localhost`. For PSTN use Railway (below) or `ngrok http 8788` and set `PUBLIC_BASE_URL=https://<id>.ngrok.app` (webhook URL changes each ngrok restart).

## Railway deploy

Railway runs the voice container with a stable `https://` URL and WebSockets; Vercel runs Next from **`apps/web`** as project root. They share **`LIVE_CALLS_PUSH_TOKEN`**.

If the Railway service shows **0 variables**, the container exits on env validation—the image can still build. Put keys on the **same** service that runs the Dockerfile.

**Twilio trial:** callers may hear a preamble and press a key before your app runs; paid Twilio removes it.

1. **Repo on GitHub.** [Railway](https://railway.app) + [Twilio](https://www.twilio.com) + Vercel (or other Next host). [Railway CLI](https://docs.railway.app/develop/cli) optional (`railway logs`).

2. **New Railway project → Deploy from GitHub** → this repo. Railway reads [`railway.json`](../../railway.json) and builds [`Dockerfile`](Dockerfile) from **repo root** (do not set context to only `apps/voice/`).

3. **Add PostgreSQL** in the project. Link `DATABASE_URL` into the voice service (`*.railway.internal` is fine **inside** the container). **`DATABASE_URL` must use database name `railway`, not `postgres`** — otherwise migrations land in an empty DB and `/health` complains `tenants` missing.

4. **Migrate + seed from your laptop** against the **same** DB the container uses. Your Mac cannot resolve `*.railway.internal` (`ENOTFOUND`). Use the Postgres **public** / TCP proxy URL from **Connect**, or `railway link` then `railway run pnpm db:migrate` and `railway run pnpm seed:voice`.

   ```bash
   DATABASE_URL='<public-or-railway-run>' pnpm db:migrate
   DATABASE_URL='<public-or-railway-run>' pnpm seed:voice
   ```

   `PII_ENCRYPTION_KEY` optional today; if you later enable encrypted PII rows, `openssl rand -hex 32` once and keep it stable.

5. **Voice service → Variables:** `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `DATABASE_URL`, `PULSE_TENANT_SLUG` (`tonys-pizza-austin`), `LIVE_CALLS_PUSH_TOKEN` (`openssl rand -hex 32` — copy same value to Vercel), `WEB_BASE_URL` (`https://<your-vercel-app>`). Omit `PUBLIC_BASE_URL` until step 7.

6. **Deploy.** Build should finish `pnpm --filter @pulse/voice… build`; deploy logs should show `[voice] listening` or a clear Zod/env error.

7. **Networking → Generate domain** on the voice service. Set `PUBLIC_BASE_URL` to that origin (no trailing slash), save, redeploy.

8. **Health:** `curl -sS https://<railway-host>/health` → `"ok":true`; `"ready":true` once DB + tenant are good (brief `ready:false` right after boot is normal).

9. **Twilio Console** → Phone numbers → your number → Voice → **A call comes in** → Webhook `https://<railway-host>/twilio/voice`, HTTP **POST**, save.

10. **Vercel:** project root **`apps/web`**. Env: same `LIVE_CALLS_PUSH_TOKEN` as Railway. Redeploy. Voice already uses `WEB_BASE_URL` to push transcripts.

11. **Smoke:** open site, dial number, speak briefly; transcript lines should appear. If Twilio says configure URL or 404, recheck 7–9.

## PSTN outbound audio

**Symptom:** Call connects (`POST /twilio/voice` 200, `GET /twilio/media` WebSocket stays up). **Homepage transcript** updates (greeting, decide loop, live-push). **Handset hears silence.**

**Already verified working**

- Inbound audio → Deepgram → `decide()` → `speak()` (transcript proves STT + LLM + push).
- `streamSid` from `frame.streamSid || frame.start.streamSid` so opening `greet()` is not skipped.
- Anthropic tools: flat `z.object` + `superRefine` in `apps/voice/src/brain/tools.ts` (no top-level `anyOf`/`oneOf`).
- Live-push ordering: `turn.appended` may arrive before `call.started`; `apps/web/lib/live-calls.ts` + `CallStage.tsx` buffer orphans.
- Barge-in suppressed until `greet()` `speak()` completes so the greeting is not cancelled immediately.
- ElevenLabs: `auto_mode=true`, `ulaw_8000`, deferred `{ "text": "" }` EOS; μ-law **chunked to 160-byte frames** before `twilioWs.send(makeMediaFrame(…))`.

**Still broken on handset**

- Tried Twilio-native **`ulaw_8000`** straight through (replacing a **pcm_16000 → resample → μ-law** path that was also silent in prod). Handset still quiet; transcript path proves the rest of the stack runs.

**Debug order**

1. **Prove ElevenLabs emits audio:** In `apps/voice/src/audio/elevenlabs.ts`, log once per turn: first non-JSON message, JSON `error`/`message`, **byte length** of first decoded `audio` chunk. If length is always 0, bug is before Twilio.
2. **Prove Twilio send path:** In `orchestrator.ts` `speak` `onChunk`, count frames, log `twilioWs.readyState`, wrap `send` and log failures.
3. **A/B formats:** Try raw base64 μ-law to Twilio vs current path, or one-shot HTTP TTS for greeting to separate WS vs codec.
4. **Twilio debugger / packet capture** vs minimal TwiML `<Say>` to confirm PSTN leg independent of Media Streams.
5. **`latency_samples` in `call_summary`:** can stay `0` on greeting-only turns (`onFirstChunk` when `callerFinalAt` unset). Not evidence of missing TTS.

## Latency

Shutdown logs `[voice] call summary {…}` with `latency_decide_ms_p50/p95` and `latency_decide_to_first_audio_ms_p50/p95`.

```bash
# Railway logs search "call_summary", or:
railway logs --service voice | grep call_summary | jq -s '
  map(.latency_decide_to_first_audio_ms_p95 // empty)
  | sort | { p50: .[length/2|floor], p95: .[length*95/100|floor] }
'
```

## Not implemented

- **Square:** `add_to_cart` is in-memory only.
- **Transfer:** `transfer_to_staff` does not dial a human.
- **Recording:** no full-call S3 capture.
