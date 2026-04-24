# Prompts

Versioned prompt modules under `packages/prompts/` were part of the **pre–ADR-038** extraction stack. That package is gone.

The **live voice agent** prompt is inline TypeScript: `apps/voice/src/brain/prompt.ts`. Edit there; keep turns short; no caller text in the system slot (`AGENTS.md`).
