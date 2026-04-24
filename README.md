# Pulse

A voice agent that takes restaurant calls, on a phone number you can dial.

Pulse is a single-page demo that puts a real working voice agent in front of a visitor. The front door at `/` shows a Twilio number and two pre-recorded sample calls (a normal pickup order and a gluten-allergy question the agent refuses to guess about). Both the sample playback and any real call coming in to the Twilio number stream into the same live transcript area on the page, so what you read is what the agent actually said and heard.

**Status:** Pivoted to a voice-agent-first demo on 2026-04-23. The previous analytics surface (operator brief, dashboard depth at `/internals/*`, extraction + insights pipelines, eval harness) was removed from the repo. See [ADR-038](docs/DECISIONS.md#adr-038--pivot-to-a-voice-agent-demo-remove-the-analytics-surface) for the why and [`docs/HANDOFF.md`](docs/HANDOFF.md) for the current state.

## Why this shape

A dashboard built on synthetic calls asks the visitor to trust aggregates they cannot verify. A **phone number that answers**, or **audio samples** you can play in a few seconds, does not. The test for this demo is simple: open the URL, play a sample (normal order), play another (allergy edge case), or dial the number and try it yourself.

The analytics narrative — extraction → insights → operator brief — that earlier ADRs spent real work building is in git history. ADR-038 spells out the trade-offs and what would be involved in bringing it back as a follow-on surface.

## Architecture

```
caller ── PSTN ── Twilio Voice ── Media Stream WS ─┐
                                                   │
                                       apps/voice/ (Hono + ws)
                                                   │
                                            Orchestrator
                                                   │
                  ┌─────────────────────────────────┼─────────────────────────────┐
                  │                                 │                             │
              Deepgram                          Claude                       ElevenLabs
              Nova-3 STT                        Sonnet 4.5                   Flash v2.5
                  │                                 │                             │
                  │                       brain/tools.ts                          │
                  │                  (say · lookup_menu_item ·                    │
                  │                   add_to_cart · transfer · end)               │
                  │                                 │                             │
                  └─────────────────► appendTurn ◄──┘                             │
                                          │                                       │
                            LivePushClient (per-turn fire-and-forget POST)        │
                                          │                                       │
                                          ▼                                       │
                          apps/web POST /api/calls/live/push ────────► LiveCallStore (in-memory)
                                                                              │
                            apps/web GET /api/calls/live (SSE) ◄──────────────┘
                                          │
                                          ▼
                                    CallStage on /
                            (renders both live calls and example
                             playbacks via the same code path)

example calls:  POST /api/calls/example { scenario }
                  → loads apps/web/public/example-calls/<scenario>.json
                  → emits turn.appended events into LiveCallStore on schedule
                  → client plays apps/web/public/example-calls/<scenario>.mp3
```

Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repo layout

```
apps/
  web/              Next.js app — single-page demo at /
    app/
      page.tsx        Hero + CallStage + Notes
      api/calls/
        live/         GET (SSE)  · POST push (auth)
        example/      POST scenario → emits into LiveCallStore
    components/voice/
      CallStage.tsx   SSE subscriber; renders live + example calls
      types.ts        Shared TranscriptTurn / LiveCall types
    lib/
      live-calls.ts   In-memory pub/sub (single-process)
    public/example-calls/
      order.{mp3,json}    Sample: pickup order, happy path
      allergy.{mp3,json}  Sample: gluten allergy, agent declines honestly
    middleware.ts     Password gate; /api/calls/live/push is public
  voice/            Twilio + Deepgram + Sonnet + ElevenLabs live agent
    src/brain/      prompt + tools + per-turn decide loop
    src/audio/      μ-law ↔ pcm16 codec + framing
    src/orchestrator.ts   per-call state machine; emits to LivePushClient
    src/live-push.ts      POSTs lifecycle/turn events to apps/web
packages/
  schema/           Zod + Drizzle (kept for the voice agent's tenant + menu lookup)
  telemetry/        llm.call() wrapper used by apps/voice
scripts/
  example-calls.ts  Builds the two sample mp3 + transcript files (OpenAI TTS)
infra/
  drizzle/          Migrations
  docker-compose.yml  Local Postgres
docs/
```

## Docs

| Doc                                            | Purpose                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| [`AGENTS.md`](AGENTS.md)                       | Invariants + recipes                             |
| [`docs/HANDOFF.md`](docs/HANDOFF.md)           | Clone → run → handoff                            |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)       | ADR-038 only (current); older ADRs = git history |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Runtime diagram + files                          |
| [`docs/DEMO.md`](docs/DEMO.md)                 | Walkthrough + ship checklist                     |
| [`docs/DESIGN.md`](docs/DESIGN.md)             | Tokens + mobile + copy                           |
| [`docs/SECURITY.md`](docs/SECURITY.md)         | RLS, gate, secrets                               |
| [`apps/voice/README.md`](apps/voice/README.md) | Voice env + Twilio                               |

## Running it

Requirements: Node 22+, pnpm 10+, Docker (for local Postgres — only required if you want to boot the voice agent).

```bash
pnpm install
cp .env.example .env               # fill in keys; minimum below
docker compose -f infra/docker-compose.yml up -d   # local Postgres
pnpm db:migrate
pnpm seed:voice                    # tenant + menu only (no synthetic calls)
pnpm check                         # typecheck + lint
pnpm dev                           # Next on :3000 + voice agent on :8788
```

Open <http://localhost:3000>. Hit the password gate. You get the Twilio number and two sample-call buttons.

**Sample calls:** the transcript streams over the same SSE channel as a real call. You need the MP3s once: `pnpm example-calls:build` (OpenAI TTS + ffmpeg). Without them, the buttons return a clear error until you run that command.

**Live calls (deployed):** the voice service ships to Railway via [`apps/voice/Dockerfile`](apps/voice/Dockerfile) + [`railway.json`](railway.json); the web app stays on Vercel. Walkthrough lives in [`apps/voice/README.md` § Deploy to Railway in 5 minutes](apps/voice/README.md#deploy-to-railway-in-5-minutes).

**Live calls (local):** set the same `LIVE_CALLS_PUSH_TOKEN` in `.env` for both processes, then expose the voice port over ngrok and point Twilio at it (URL changes every restart, so this is for spot-tests only):

```bash
ngrok http 8788
# Twilio "A call comes in" → https://<id>.ngrok.app/twilio/voice
# In .env: PUBLIC_BASE_URL=https://<id>.ngrok.app  WEB_BASE_URL=http://127.0.0.1:3000
pnpm dev                           # or: pnpm dev:web  and  pnpm dev:voice  in two terminals
```

To rebuild the example call audio (after editing `scripts/example-calls.ts`):

```bash
pnpm example-calls:build           # OpenAI TTS + ffmpeg → apps/web/public/example-calls/
```

### Minimum env

| Key                     | Why                                                                              |
| ----------------------- | -------------------------------------------------------------------------------- |
| `DEMO_PASSWORD`         | Password gate.                                                                   |
| `DEMO_COOKIE_SECRET`    | HMAC for the gate cookie. Any 32+ byte string.                                   |
| `TWILIO_PHONE_NUMBER`   | The number rendered on the homepage. Cosmetic if `apps/voice/` isn't deployed.   |
| `OPENAI_API_KEY`        | Required by `pnpm example-calls:build` (TTS for the sample call audio).          |
| `LIVE_CALLS_PUSH_TOKEN` | Bearer token that gates `/api/calls/live/push`. The voice agent sends it.        |
| `ANTHROPIC_API_KEY`     | `apps/voice/` only — Claude Sonnet 4.5 powers the per-turn decision.             |
| `DEEPGRAM_API_KEY`      | `apps/voice/` only — streaming STT.                                              |
| `ELEVENLABS_API_KEY`    | `apps/voice/` only — streaming TTS for the live agent.                           |
| `ELEVENLABS_VOICE_ID`   | `apps/voice/` only — paid-tier voice id.                                         |
| `TWILIO_ACCOUNT_SID`    | `apps/voice/` only — needed when the agent dials out / verifies signatures.      |
| `TWILIO_AUTH_TOKEN`     | `apps/voice/` only.                                                              |
| `DATABASE_URL`          | Postgres after `pnpm db:migrate`.                                                |
| `PII_ENCRYPTION_KEY`    | Required by `@pulse/schema` for `pnpm db:migrate` / clients.                     |
| `PUBLIC_BASE_URL`       | Voice server URL Twilio reaches (defaults to `http://127.0.0.1:8788` for local). |
| `WEB_BASE_URL`          | Next origin for transcript push (defaults to `http://127.0.0.1:3000`).           |

After a fresh DB, run `pnpm seed:voice` once to create the `tonys-pizza-austin` tenant + menu.

The deployed demo is password-gated via `DEMO_PASSWORD`. No user accounts.

## Contributing

Before you push:

```bash
pnpm check        # typecheck + lint + unit across all packages
pnpm format       # prettier write
```

Conventions and invariants live in [`AGENTS.md`](AGENTS.md). The big ones for this surface: every LLM call in `apps/voice/` goes through `@pulse/telemetry`'s `llm.call()`, the front door at `/` is a single page (no second route, no marketing landing), and any "live" framing on the page must actually be live (no fake transcript animations, no canned latency claims).

## License

Unlicensed.
