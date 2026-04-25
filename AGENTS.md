# AGENTS.md

Operating manual for any agent (or human) touching this repo. Read before editing. If something here contradicts a user message, ask.

High-leverage files: this doc, `packages/schema/`, `apps/voice/src/brain/prompt.ts`. Treat schema and prompt edits as high risk.

## What this is

Pulse is a single-page demo of a restaurant voice agent. `/` shows a Twilio number, two pre-recorded sample calls, and a live transcript. Samples and live calls share `CallStage` + the same SSE channel (`apps/web/components/voice/CallStage.tsx`).

Read [`README.md`](README.md) and [`apps/voice/README.md`](apps/voice/README.md) (§ PSTN outbound audio) before large changes.

## Hard invariants

Treat these as ship blockers.

1. **Schemas in `packages/schema/` are the single source of truth.** DB types and tenant lookups in `apps/voice/` derive from Zod. A duplicated `interface` or `type` that mirrors a schema is a bug.

2. **Every LLM call uses `llm.call()` from `packages/telemetry/`.** Never call the vendor SDK directly from feature code. The wrapper handles cost tracking, retries, and tracing.

3. **Untrusted content never in the system prompt slot.** Caller speech is user content; system prompts are developer content. Mixing them is how prompt injections escalate.

4. **Tenant isolation is Postgres RLS.** Every query in `apps/voice/` runs with `app.tenant_id` set. Cross-tenant access requires an explicit `// CROSS-TENANT: reason` comment. App-layer filtering is defense in depth, not the primary boundary.

5. **The homepage (`/`) is the only voice-agent UI.** One page: hero, phone number, two sample-call buttons, live transcript. No parallel homepage or duplicate transcript UX. Samples and live calls use the same `CallStage` + SSE path.

6. **No fake liveness.** The transcript shows real turns from real sessions (live or example playback). No fabricated “thinking…” lines, fake latency numbers, or canned agent lines that never came from the stack.

7. **Mobile-first. Nothing broken below 375px.** Touch targets ≥ 44px. Phone number is `tel:` on mobile. Transcript scrolls; no hover-only affordances without a tap equivalent.

8. **No placeholder copy.** Every UI string is intentional. If you do not know the copy, ask.

9. **Design tokens only** for color, type, spacing: `apps/web/app/globals.css` (CSS variables) via `tailwind.config.ts`. Inline hex or arbitrary `px` in components are bugs. Default motion ~150ms; wrap decorative motion >100ms in `prefers-reduced-motion`.

10. **Example calls are pre-recorded, honestly labeled.** Buttons play `apps/web/public/example-calls/<scenario>.mp3` and stream `<scenario>.json` through the same SSE channel as live calls. Build: `pnpm example-calls:build` (`scripts/example-calls.ts`). ElevenLabs licensing: see `apps/voice/README.md` § Env.

11. **`apps/voice/` is the live transport.** Events (`call.started`, `turn.appended`, `call.ended`) go through `apps/voice/src/live-push.ts` → `POST /api/calls/live/push` with `LIVE_CALLS_PUSH_TOKEN`. No parallel transport. New event types: extend `apps/web/components/voice/types.ts`, `LiveCallStore` (`apps/web/lib/live-calls.ts`), `CallStage`, emitter in voice or `apps/web/app/api/calls/example/`.

12. **Demo data stays honest.** Notes on `/` say Tony's Pizza Austin is fictional. No fake traffic or metrics.

## Don't

- Bypass `llm.call()` to save a line.
- Add a DB column without a Drizzle migration in the same PR.
- Disable RLS "to debug faster." Use `SET LOCAL app.tenant_id = '...'`.
- Inline real phone numbers, emails, or personal identifiers in code or docs except `TWILIO_PHONE_NUMBER` and contact info already chosen for the public homepage/footer.
- Commit `.env*` files.
- Fabricate file paths or line numbers. Grep first.
- Hardcode colors, font sizes, or spacing. Use tokens.
- Ship animations longer than 250ms. 150ms default.
- Marketing adjectives in product copy (“powerful”, “AI-driven”). Say what it does.
- Bypass the password gate in dev. Configure the gate or use `/gate` like production.
- Add a top-level `apps/web/app/<name>/` route without a strong reason. API routes today: `/api/calls/live`, `/api/calls/live/push`, `/api/calls/example`, `/api/health`.
- Add a second transcript pipeline or duplicate homepage that bypasses `CallStage` / the live SSE contract.
- Desync example playback from audio: transcript JSON timing must match the mp3.

## Recipes

### Add an example call scenario

1. Edit `scripts/example-calls.ts` — add `SCENARIOS` entry; turns `{ speaker: 'caller' | 'agent', text, voice }`.
2. `ELEVENLABS_API_KEY=... pnpm example-calls:build` → `apps/web/public/example-calls/<slug>.{mp3,json}`.
3. New button in `apps/web/components/voice/CallStage.tsx` → `POST /api/calls/example` with `scenario`.
4. Adjust Notes on `apps/web/app/page.tsx` if the story changed.

### Change the live agent

1. Read `apps/voice/README.md` (§ PSTN if you touch TTS/Twilio). Loop: `decide()` → `AgentTurnSchema` in `apps/voice/src/brain/tools.ts`.
2. System prompt: `apps/voice/src/brain/prompt.ts` (small edits; paged every turn).
3. Tools: `brain/tools.ts` — single `z.object` + `superRefine` for Anthropic; keep `applyTool` exhaustive.
4. Test: dial live agent, or local `pnpm dev` in `apps/voice` with synthetic traffic as you prefer.

### Add a transport event type

1. `CallEvent` in `apps/web/components/voice/types.ts`.
2. `LiveCallStore.publish` in `apps/web/lib/live-calls.ts`.
3. `CallStage.tsx`.
4. Emit from `apps/voice/src/live-push.ts` and/or `apps/web/app/api/calls/example/route.ts`.

### Build or change UI

1. Tokens + mobile rules above; reference `globals.css`.
2. Primary files: `apps/web/app/page.tsx`, `apps/web/components/voice/CallStage.tsx`.
3. Mobile-first (375px first). Real copy in the same change. Empty + error states (SSE drop, example fetch fail, audio error). Keyboard: tab order, focus rings.

## Workflow

- Touching many files: sketch the change first.
- `pnpm check` before done. Commit message = why.
- Errors for humans (e.g. voice unreachable → check process + `LIVE_CALLS_PUSH_TOKEN`), not bare status codes.

## Open questions

Do not silently decide these:

- **Multi-process:** `LiveCallStore` is in-memory; multi-region needs Redis/Postgres pub/sub or sticky routing.
- **Recording / consent:** No S3 recording or consent line here; legal requirements vary by jurisdiction.
- **Language:** Deepgram `en-US`; prompt English-only.
- **Persistence:** Live turns are not stored durably; adding that is a small schema + write path if needed later.

## Editing this file

Update when an invariant changes after a real bug, a recipe repeats (3×), or the demo’s security/transport story changes. Otherwise leave it alone.
