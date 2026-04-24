# Design

Read before changing `apps/web`. Tokens are truth: `apps/web/app/globals.css` (CSS custom properties), wired through Tailwind.

## Posture

Light mode only. Warm cream base (`--bg-base`), near-black type (`--text-primary`), yellow accent (`--accent-yellow`), black pill primary CTAs (`--accent-black`). Rounded corners, subtle grid on the page body. Consumer B2B, not enterprise slate.

Anti-patterns: stock illustration carousels, gradient hero text, purple “AI” sludge, fake metrics.

## Color (reference)

Core tokens (see `globals.css` for full set):

- Backgrounds: `--bg-base`, `--bg-surface`, `--bg-surface-2`, `--bg-surface-3`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Accent: `--accent-yellow`, `--accent-black` (+ hovers)
- Border: `--border`, `--border-strong`

Never body text in yellow on white (contrast). Yellow is marker / badge / live dot, not paragraph color.

## Typography

Geist / Geist Mono (self-hosted under `apps/web/app/fonts/`). Transcript rows: readable sans ~14–15px; metadata labels in mono caps.

## Motion

Default UI transitions ~150ms. `prefers-reduced-motion`: no decorative motion; state changes stay instant.

## Copy

- Specific, warm, short. No “powerful / innovative / AI-driven.”
- Errors for humans: _Could not start the sample — run `pnpm example-calls:build`._ not raw status codes.
- No lorem. Empty states say what to do next.

## Mobile

**Nothing ships broken below 375px.** Touch targets ≥ 44px. Phone number uses `tel:`. `CallStage` transcript scrolls; no hover-only affordances without a tap equivalent.

Test at 375px and one desktop width before merge.

## Current front door

`/` = hero + `CallStage` + notes/footer. No second marketing layer. No `/internals/*` in this tree.
