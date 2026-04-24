# Decisions (ADRs)

Only **ADR-038** is authoritative for the current tree. ADR-001–037 described the removed analytics pipeline; full text is in git history (`git log --follow -p -- docs/DECISIONS.md`).

---

## ADR-038 — Pivot to a voice-agent demo; remove the analytics surface

**Date:** 2026-04-23 · **Status:** Accepted, supersedes ADR-036, ADR-037

**Context:** The operator-brief demo still asked visitors to trust synthetic aggregates. Proof that fits in half a minute is auditory: a number you can dial, or samples you can hear, right away.

**Decision:**

- `/` is one page: Twilio number, two sample buttons, `CallStage` transcript fed by `GET /api/calls/live` (SSE).
- Samples: `public/example-calls/*.{json,mp3}` built by `pnpm example-calls:build` (OpenAI TTS in the script; live agent uses ElevenLabs in `apps/voice/`).
- Live turns: `apps/voice/src/live-push.ts` → `POST /api/calls/live/push` with `LIVE_CALLS_PUSH_TOKEN`.
- Analytics UI and heavy packages (`insights`, `evals`, `extraction`, `guest-graph`, `api` app, etc.) **removed** from the repo. `packages/schema` kept for tenant/menu and future work.

**Pros:** 30-second test is real; repo is small; one UI path for sample + live.

**Cons:** No in-product eval replay or brief; Twilio + keys needed for strongest demo.

**Reversibility:** Medium. Restore from git if a follow-on needs the old stack.

---

## Template

```
## ADR-NNN — <short title>

**Date:** YYYY-MM-DD · **Status:** Proposed | Accepted | Superseded | Rejected

<context>

<decision — bullets, link to code>

- **Pros:** …
- **Cons:** …
- **Reversibility:** high | medium | low
```
