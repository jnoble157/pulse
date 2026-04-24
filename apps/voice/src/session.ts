/**
 * `CallSession` — per-call state for the voice agent.
 *
 * Created when Twilio opens the media stream, lives until `stop`. Holds:
 *   - turns:        the running transcript (agent + caller, with timestamps)
 *   - cart:         items the agent committed to via `add_to_cart`
 *   - terminal:     `transferred` / `ended` / null
 *   - latency_log:  per-turn measured times for the DEMO.md publish
 *
 * Thin by design. The audio + brain modules act on it. The ingest module
 * reads it once at hangup and converts to `IngestCallEvent`.
 */
import type { CartItem, MenuItem } from '@pulse/schema';

export type Speaker = 'agent' | 'caller';

export type SessionTurn = {
  turn_index: number;
  speaker: Speaker;
  text: string;
  t_start_ms: number;
  t_end_ms: number;
};

export type SessionCart = CartItem[];

export type Terminal = { kind: 'transferred' | 'ended'; reason: string } | null;

export type LatencyEvent = {
  turn_index: number;
  /** Caller stopped speaking → first audio frame sent back to Twilio. */
  decide_to_first_audio_ms: number;
  /** Caller stopped speaking → decide() returned. */
  decide_ms: number;
  /** Caller stopped speaking → ElevenLabs WebSocket opened. */
  tts_open_ms: number | null;
  /** Caller stopped speaking → first ElevenLabs audio chunk arrived. */
  tts_first_chunk_ms: number;
  /** Caller stopped speaking → first Twilio media frame was sent. */
  first_twilio_frame_ms: number;
};

export class CallSession {
  callId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  brandVoice: string | null;
  menu: MenuItem[];
  startedAt: Date;
  startedAtMonotonic: number;
  turns: SessionTurn[] = [];
  cart: SessionCart = [];
  terminal: Terminal = null;
  latency: LatencyEvent[] = [];

  constructor(opts: {
    callId: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    brandVoice: string | null;
    menu: MenuItem[];
  }) {
    this.callId = opts.callId;
    this.tenantId = opts.tenantId;
    this.tenantName = opts.tenantName;
    this.tenantSlug = opts.tenantSlug;
    this.brandVoice = opts.brandVoice;
    this.menu = opts.menu;
    this.startedAt = new Date();
    this.startedAtMonotonic = performance.now();
  }

  /** ms since the call started, monotonic. */
  now(): number {
    return performance.now() - this.startedAtMonotonic;
  }

  appendTurn(speaker: Speaker, text: string, t_start_ms: number, t_end_ms: number): SessionTurn {
    const turn = {
      turn_index: this.turns.length,
      speaker,
      text,
      t_start_ms,
      t_end_ms,
    };
    this.turns.push(turn);
    return turn;
  }
}
