# Demo

## Live site

Password gate, then `/`: Twilio number, two sample buttons, live transcript (SSE).

- **Samples:** need `order.mp3` / `allergy.mp3` once: `pnpm example-calls:build`. Transcript timing comes from the matching `.json` manifests.
- **Live dial:** voice server reachable from Twilio over a stable `https://`. Production: deploy to Railway per [`apps/voice/README.md` § Deploy to Railway in 5 minutes](../apps/voice/README.md#deploy-to-railway-in-5-minutes). Same `LIVE_CALLS_PUSH_TOKEN` on Vercel + Railway so pushes authenticate.

No fictional metrics on the page. If it is not measured or not emitted as an event, do not show it.

## Suggested walkthrough (~90 s)

| Time | Beat                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- |
| 0:00 | One line who you are; show `/`.                                                                   |
| 0:10 | Tap sample 1 (Order a pizza): audio + transcript fill in together.                                |
| 0:35 | Tap sample 2 (Ask about an allergy): note that the agent declines honestly and offers a callback. |
| 0:55 | Optional: dial Twilio, one exchange, hang up; transcript appears.                                 |
| End  | CTA: repo / email / next step.                                                                    |

## Ship checklist

Latest sweep: 2026-04-23, on `localhost:3000` running this commit.

- [x] **Both samples play through cleanly.** Order + allergy both rendered on Chrome desktop with transcript synced to audio. New opener (`Tony's Pizza, Austin. What can I get started for you?`) reads correctly; no "this is the agent" self-reference in either script.
- [x] **PhoneHeader layout balances at desktop + mobile.** 1440px desktop: number left, divider, two sample buttons stacked right. 375px viewport: stacks to single column with the divider becoming a top border between groups; sample buttons keep `min-h-[44px]` for touch (per `docs/DESIGN.md §Mobile`). Verified bounding box of the phone-number link at 375px width fits without wrapping.
- [x] **Footer links updated.** `mailto:josh.noble13@gmail.com`, `https://www.linkedin.com/in/josh-n-650238a1/`.
- [x] **No real console errors on cold load.** Only non-app noise: React DevTools nag, hydration mismatch caused by browser-extension `data-cursor-ref` injection (not produced by the app).
- [x] **Existing transport tests pass.** `apps/web/tests/{live-calls,api-live-push,api-example}.test.ts` — 11 tests, green.
- [x] **Voice container builds and boots.** `docker build -f apps/voice/Dockerfile -t pulse-voice:test .` succeeds; container exits cleanly on missing required env (validation works).
- [ ] **Safari iOS at 375px and Chrome Android at 412px.** Pending: open the deployed URL on each, tap both samples, confirm `tel:` opens the dial sheet on iOS, confirm SSE stays connected after backgrounding the tab for 30s. Note any drift back here.
- [ ] **Live Twilio dial against the deployed Railway service.** Pending: dial `+1 (575) 221-8619`, run an order through, hang up, confirm transcript on the deployed homepage. After ~10 calls, fill the latency table in [`apps/voice/README.md`](../apps/voice/README.md#latency).

## Run locally

See root `README.md` (`db:migrate`, `seed:voice`, `example-calls:build`, `pnpm dev`).
