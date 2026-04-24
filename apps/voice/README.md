# @pulse/voice

Live Twilio phone agent: Deepgram STT → Claude (structured turn) → ElevenLabs TTS. Each caller and agent line is pushed to the Next app (`POST /api/calls/live/push`) so the homepage transcript updates in real time when `LIVE_CALLS_PUSH_TOKEN` and `WEB_BASE_URL` are set.

The agent reads **tenant + menu** from Postgres at boot (`DATABASE_URL` + `PULSE_TENANT_SLUG`). Run `pnpm seed:voice` from the repo root if you only need a menu, not synthetic calls.

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

| Key                                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                       | HTTP + WS port (default 8788).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PUBLIC_BASE_URL`                            | Host Twilio reaches for `/twilio/voice` + `wss://…/twilio/media`. Defaults to `http://127.0.0.1:8788` (local only; use ngrok for real PSTN).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `WEB_BASE_URL`                               | Next.js origin for transcript push. Defaults to `http://127.0.0.1:3000`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `LIVE_CALLS_PUSH_TOKEN`                      | Optional. Same bearer token as the web app; without it the agent still talks on the phone, the homepage just does not get turns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ANTHROPIC_API_KEY`                          | Claude per-turn decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DEEPGRAM_API_KEY`                           | Streaming STT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | Streaming TTS (default model `eleven_flash_v2_5`). **Free tier:** includes a monthly credit pool (e.g. 10k credits on the current Free plan—check ElevenLabs for the exact meter). That is often enough for **light personal / interview-demo** traffic. **Caveats:** (1) long or frequent calls burn credits quickly; (2) ElevenLabs’ Free plan does **not** include a commercial license for generated speech—if the demo is public-facing or for a company, read their terms and consider **Starter** or higher for licensing + higher limits; (3) if a voice id or REST endpoint returns 403 on your tier, pick another stock voice or upgrade—`pnpm example-calls:build` may still use OpenAI TTS for offline sample MP3s (see `scripts/example-calls.ts` header). |
| `ELEVENLABS_MODEL`                           | Defaults to `eleven_flash_v2_5`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PULSE_TENANT_SLUG`                          | Defaults to `tonys-pizza-austin`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DATABASE_URL`                               | Resolve tenant + menu on boot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AGENT_MODEL`                                | `claude-sonnet-4-5` (default) or `claude-haiku-4-5`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Local development

From repo root (loads root `.env`):

```bash
pnpm db:migrate && pnpm seed:voice
pnpm dev                    # or: pnpm dev:voice
```

The voice server answers on `:8788` but Twilio can't reach `localhost`. For real PSTN testing, deploy to Railway (below) — that gives you a stable `https://` URL Twilio can hit. ngrok still works as an escape hatch (`ngrok http 8788`, set `PUBLIC_BASE_URL=https://<id>.ngrok.app`), but the URL changes every restart so you'll be reconfiguring the Twilio webhook constantly.

## Deploy to Railway in 5 minutes

Railway gives the voice service a stable public `https://` URL (with WebSocket support) so Twilio can hit it without ngrok. The web app stays on Vercel; the two services talk through `LIVE_CALLS_PUSH_TOKEN`.

### What you are doing on Railway (plain English)

Think of **three boxes**: (1) **Postgres** = where Tony’s menu and tenant row live. (2) **Pulse voice service** = the Node app that Twilio talks to; it reads Postgres on startup and streams audio + decisions. (3) **Vercel** = the website; it does **not** run the phone stack, it only receives **transcript lines** from the voice box over HTTPS.

**Railway’s job** is to run box (2) and optionally host box (1). You connect GitHub so every push can rebuild the Docker image. You add Postgres so the agent has a real database in the cloud. You copy **secrets** (API keys, one shared `LIVE_CALLS_PUSH_TOKEN`) into Railway’s environment so the container starts. You click **Generate domain** so box (2) gets a permanent `https://…` URL—that URL is what you paste into Twilio and into `PUBLIC_BASE_URL`.

**If the dashboard shows “0 Variables” on the Pulse service**, the container will exit immediately during env validation (missing `ANTHROPIC_API_KEY`, etc.). The Docker build can succeed while the **deploy / healthcheck** still fails. Open **Variables** on the **same service** that runs the Dockerfile and add every row from step 3 below, including **`DATABASE_URL`** (use Railway’s “Variable Reference” to pull it from the Postgres plugin if you prefer).

**Twilio’s job** is: when someone dials your number, Twilio opens an HTTPS request to your Railway URL (`/twilio/voice`) and then a **WebSocket** for raw audio. None of that works if the URL is still `localhost`.

**Your laptop’s job** (once): run **migrations + seed** against the **Railway** Postgres URL so the `tenants` / menu tables exist before the voice service boots. After that, day‑to‑day is just Railway + Vercel env vars and redeploys.

### After Railway is green: Twilio webhook (order of operations)

- Confirm the voice service is **deployed** and `curl -sS https://<railway-host>/health` returns JSON with `"ok":true` and ideally `"ready":true` (after migrations + seed, see step 2). `"ready":false` for a few seconds right after boot is normal.
- Twilio Console → **Phone numbers** → your number → **Voice & Fax** (or “Configure”) → **A call comes in** → **Webhook** (not TwiML Bin unless you know you need that) → URL: `https://<railway-host>/twilio/voice` → HTTP **POST** → Save.
- **Trial accounts** may ask the caller to press a key before your app runs; upgrading Twilio removes that.

1. **New Railway project → Deploy from GitHub repo.** Pick this repo. Railway picks up [`railway.json`](../../railway.json) at the repo root, which points at [`apps/voice/Dockerfile`](Dockerfile). Build context is the repo root so the Dockerfile can pull in `@pulse/schema` and `@pulse/telemetry`.

2. **Add a Postgres plugin** to the Railway project. Bind its `DATABASE_URL` to the voice service (the **`*.railway.internal`** URL is correct for the running container). **Your laptop cannot resolve `*.railway.internal`:** for `pnpm db:migrate` / `pnpm seed:voice` use either (a) the Postgres **public** / **TCP proxy** URL from **Connect** in the Railway dashboard, or (b) from the repo: `railway link` then `railway run pnpm db:migrate` and `railway run pnpm seed:voice` so the command runs inside Railway’s network.

   ```bash
   DATABASE_URL=<public-or-proxy-postgres-url> pnpm db:migrate
   DATABASE_URL=<public-or-proxy-postgres-url> pnpm seed:voice
   ```

   This creates the `tonys-pizza-austin` tenant + menu the agent needs at boot.

3. **Set service variables** in Railway → Variables:

   | Var                     | Value                                                                                  |
   | ----------------------- | -------------------------------------------------------------------------------------- |
   | `ANTHROPIC_API_KEY`     | from Anthropic Console                                                                 |
   | `DEEPGRAM_API_KEY`      | from Deepgram Console                                                                  |
   | `ELEVENLABS_API_KEY`    | from ElevenLabs (free tier often OK for a light demo; see §Env for licensing / limits) |
   | `ELEVENLABS_VOICE_ID`   | the voice id you want the agent to use                                                 |
   | `PII_ENCRYPTION_KEY`    | `openssl rand -hex 32` (must match the value used at migrate)                          |
   | `PULSE_TENANT_SLUG`     | `tonys-pizza-austin`                                                                   |
   | `LIVE_CALLS_PUSH_TOKEN` | `openssl rand -hex 32` — also set this on Vercel                                       |
   | `WEB_BASE_URL`          | `https://<your-vercel-app>`                                                            |
   | `PUBLIC_BASE_URL`       | leave unset for now — we set it in step 4                                              |

4. **Generate a public domain.** Railway service → Settings → Networking → Generate Domain. Copy the `https://*.up.railway.app` URL. Set `PUBLIC_BASE_URL` to that exact URL and redeploy.

5. **Point Twilio at the service.** Twilio Console → Phone Numbers → your number → Voice Configuration → "A call comes in" → Webhook → `https://<your-railway-domain>/twilio/voice`, HTTP POST. Save.

6. **Add `LIVE_CALLS_PUSH_TOKEN` to Vercel** (same value as Railway). Redeploy the web app so the env propagates.

Dial the number. The agent should answer as Tony's Pizza, Austin and the transcript should appear on the deployed homepage in real time.

### Railway setup (step-by-step)

Use this if you prefer a single checklist over the six bullets above.

1. **Prerequisites.** Code is on GitHub. You have accounts for [Railway](https://railway.app), [Twilio](https://www.twilio.com), and whatever hosts the Next app (e.g. Vercel). Install [Railway CLI](https://docs.railway.app/develop/cli) only if you want `railway logs` from your laptop—everything else is in the web UI.

2. **Create the project.** Railway dashboard → **New Project** → **Deploy from GitHub repo** → authorize GitHub if asked → select this repository. Railway should read [`railway.json`](../../railway.json) and build with [`Dockerfile`](Dockerfile) from **repo root** (important: do not set the Dockerfile context to only `apps/voice/`).

3. **Add Postgres.** In the same project → **New** → **Database** → **Add PostgreSQL**. When it finishes provisioning, open the Postgres service → **Variables** and copy `DATABASE_URL` (or use Railway’s **Connect** / service linking so your **voice** service receives `DATABASE_URL` automatically—either is fine as long as the running voice container sees a valid `DATABASE_URL`). **Important:** the URL must end with **`/railway`**, not **`/postgres`**. The default `postgres` database is empty; Railway’s plugin data (and your migrations) live in the **`railway`** database. If `/health` says `tenants` does not exist, check the last path segment of `DATABASE_URL`.

4. **Migrate and seed (from your machine).** One-time against the **same** Railway Postgres the voice app uses. Do **not** use `postgres.railway.internal` on your Mac (`ENOTFOUND`). Use the **public** connection string from the Postgres service **Connect** tab, or `railway run pnpm db:migrate` / `railway run pnpm seed:voice` after `railway link`.

   ```bash
   DATABASE_URL='<public-tcp-url-or-use-railway-run>' pnpm db:migrate
   DATABASE_URL='<public-tcp-url-or-use-railway-run>' pnpm seed:voice
   ```

   Use the **same** `PII_ENCRYPTION_KEY` you will set on the voice service in the next step (generate once with `openssl rand -hex 32` and never rotate casually—rotating breaks decrypting existing rows).

5. **Configure the voice service.** Open the **web** service Railway created from the Dockerfile (rename it to `voice` if you like). **Variables** tab → add every row from step 3 of the short list above (`ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_*`, `DATABASE_URL`, `PII_ENCRYPTION_KEY`, `PULSE_TENANT_SLUG`, `LIVE_CALLS_PUSH_TOKEN`, `WEB_BASE_URL`). Omit `PUBLIC_BASE_URL` until step 6.

6. **First deploy.** Trigger a deploy (push to the tracked branch, or **Deployments** → **Redeploy**). Open **Build logs**: the image should finish `pnpm --filter @pulse/voice... build` without error. Open **Deploy logs**: you should see `[voice] listening` or, if env is wrong, a clear zod/env validation error—fix vars and redeploy.

7. **Public URL.** Service → **Settings** → **Networking** → **Generate domain**. You get something like `https://your-service-production.up.railway.app`. Set **`PUBLIC_BASE_URL`** to that exact origin (no trailing slash) in the voice service variables → save (Railway redeploys).

8. **Health check (optional).** `curl -sS https://<your-railway-host>/health` should return JSON with `"ok":true` and your tenant slug once the process is up and DB is reachable.

9. **Twilio.** [Twilio Console](https://console.twilio.com) → **Phone Numbers** → **Manage** → Active Numbers → your number → **Voice Configuration** → **A call comes in** → **Webhook** → URL `https://<your-railway-host>/twilio/voice`, HTTP **POST** → Save.

10. **Vercel (or other web host).** Create the project from this repo with **Root Directory** set to **`apps/web`** (the Next.js site). If Vercel’s root is `apps/voice` or the repo root, installs will not see `next` in that folder’s `package.json` and the build will fail. Project → **Settings** → **Environment Variables** → add `LIVE_CALLS_PUSH_TOKEN` with the **same** string as Railway. Redeploy the frontend. The voice service already has `WEB_BASE_URL` pointing at this site so `POST …/api/calls/live/push` hits production.

11. **Smoke test.** Open the live site, dial the Twilio number, say a short line; transcript lines should appear within a turn or two. If Twilio plays “configure URL” or 404, the webhook URL or `PUBLIC_BASE_URL` / TLS path is wrong—re-check steps 7–9.

### Twilio trial accounts

If your Twilio account is on a trial, callers hear a Twilio-generated preamble ("you have a trial account, press a key to execute your app") before the webhook fires. Once they press a key, the agent answers normally. To remove the preamble: Twilio Console → Upgrade ($20 minimum credit). The demo works either way; the preamble is just less elegant.

## Latency

The orchestrator records decide time and time-to-first-audio per turn. On call shutdown it logs a structured `[voice] call summary {…}` JSON line with `latency_decide_ms_p50/p95` and `latency_decide_to_first_audio_ms_p50/p95` over the call's turns.

Pull the numbers from Railway logs after ~10 real calls:

```bash
# Railway → service → Logs → "Search" tab
"call_summary"
# or via the Railway CLI:
railway logs --service voice | grep call_summary | jq -s '
  map(.latency_decide_to_first_audio_ms_p95 // empty)
  | sort | { p50: .[length/2|floor], p95: .[length*95/100|floor] }
'
```

Publish the actual figures here, do not invent them:

| Metric                                                                     | p50                             | p95   |
| -------------------------------------------------------------------------- | ------------------------------- | ----- |
| `decide_ms` (caller stops → decide() returns)                              | _TBD after first 10 real calls_ | _TBD_ |
| `decide_to_first_audio_ms` (caller stops → first TTS chunk back to Twilio) | _TBD_                           | _TBD_ |

## What's missing / next

- **PSTN audio (blocking demo):** Caller hears silence while the web transcript updates. See [`docs/HANDOFF.md` § PSTN outbound audio](../../docs/HANDOFF.md#pstn-outbound-audio-open-issue--apr-2026) for symptoms, what was tried, and a ordered debug list (ElevenLabs proof → Twilio send → format A/B).
- **Square POS:** `add_to_cart` is in-memory; wire Square in `brain/tools.ts` when needed.
- **Transfer:** `transfer_to_staff` does not dial a human yet.
- **Recording:** no full-call recording to S3.
