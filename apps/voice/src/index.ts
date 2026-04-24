/**
 * Voice agent entrypoint. See `apps/voice/README.md` for the runbook.
 *
 * Stack: Twilio Programmable Voice ↔ Hono WebSocket bridge ↔ Deepgram Nova-3
 * STT, Claude Sonnet 4.5 turn manager (via @pulse/telemetry's llmCall),
 * ElevenLabs Flash v2.5 streaming TTS. Per-turn transcript events POST to
 * the Next app (`/api/calls/live/push`) when `LIVE_CALLS_PUSH_TOKEN` is set.
 *
 * The call audio path bypasses LiveKit Agents intentionally; Twilio Media
 * Streams + direct WebSocket bridges keep the moving parts auditable and
 * latency measurable. If we revisit, the brain/audio split here drops into
 * a LiveKit Agents Worker without rewriting the decision loop.
 */
import { startServer } from './server.js';

startServer().catch((err) => {
  console.error('[voice] failed to start:', err);
  process.exit(1);
});

export const PULSE_VOICE_VERSION = '0.1.0';
