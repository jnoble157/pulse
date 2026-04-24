/**
 * Per-call orchestrator. Wires Twilio media → Deepgram STT → Claude decide
 * → ElevenLabs TTS → Twilio media. One instance per active call.
 *
 * Flow:
 *   1. Twilio `start`        → open Deepgram WS, build CallSession
 *   2. Twilio `media`        → μ-law decode → upsample → Deepgram
 *   3. Deepgram `is_final`   → append turn → call decide()
 *   4. decide() returns      → if `say`, stream TTS to Twilio; else apply
 *                              tool, append a tool-result turn, decide again
 *   5. Twilio `stop`         → flush, close, POST IngestCallEvent
 *
 * Barge-in:
 *   - On Deepgram interim results that look like speech (>= 2 chars), if
 *     the agent is currently speaking, send a `clear` to Twilio and cancel
 *     the in-flight TTS. The agent then waits for the caller's final.
 *
 * Latency:
 *   - Stamped on the session at `caller_final → first TTS chunk`. Surfaced
 *     in the IngestCallEvent metadata for DEMO.md publishing.
 */
import type { WebSocket as WsWebSocket } from 'ws';
import type { MenuItem } from '@pulse/schema';
import { CallSession } from './session.js';
import { parseInbound, makeMediaFrame, makeClear, type TwilioInbound } from './audio/twilio.js';
import { muLawToPcm16 } from './audio/codec.js';
import { DeepgramSession, upsample8to16 } from './audio/deepgram.js';
import { streamTts } from './audio/elevenlabs.js';
import { decide } from './brain/decide.js';
import { applyTool, type ToolResult } from './brain/tools.js';
import { LivePushClient } from './live-push.js';
import type { VoiceEnv } from './env.js';

export type TenantContext = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  brandVoice: string | null;
  menu: MenuItem[];
};

export class Orchestrator {
  private session: CallSession | null = null;
  private deepgram: DeepgramSession | null = null;
  private streamSid: string | null = null;
  private speaking: { cancel: () => void } | null = null;
  private callerFinalAt: number | null = null;
  private deciding = false;
  private pendingDecide = false;
  private callStartMs = 0;
  private readonly livePush: LivePushClient;
  private callerNumber: string | null = null;

  constructor(
    private readonly twilioWs: WsWebSocket,
    private readonly tenant: TenantContext,
    private readonly env: VoiceEnv,
  ) {
    this.livePush = new LivePushClient({
      baseUrl: env.WEB_BASE_URL,
      token: env.LIVE_CALLS_PUSH_TOKEN,
    });
    twilioWs.on('message', (data) => this.handleTwilioFrame(data.toString('utf8')));
    twilioWs.on('close', () => this.shutdown('twilio_closed'));
    twilioWs.on('error', () => this.shutdown('twilio_error'));
  }

  private handleTwilioFrame(raw: string): void {
    const frame = parseInbound(raw);
    if (!frame) return;
    switch (frame.event) {
      case 'connected':
        return;
      case 'start':
        return this.handleStart(frame);
      case 'media':
        return this.handleMedia(frame);
      case 'stop':
        return void this.shutdown('twilio_stop');
      case 'mark':
        return;
    }
  }

  private handleStart(frame: Extract<TwilioInbound, { event: 'start' }>): void {
    this.streamSid = frame.streamSid;
    this.callStartMs = Date.now();
    this.callerNumber =
      (frame.start as unknown as { customParameters?: { caller?: string }; from?: string }).from ??
      null;
    this.session = new CallSession({
      callId: frame.start.callSid,
      tenantId: this.tenant.tenantId,
      tenantName: this.tenant.tenantName,
      tenantSlug: this.tenant.tenantSlug,
      brandVoice: this.tenant.brandVoice,
      menu: this.tenant.menu,
    });

    this.deepgram = new DeepgramSession({
      apiKey: this.env.DEEPGRAM_API_KEY,
      keyterms: this.tenant.menu.slice(0, 32).map((m) => m.name),
      onTranscript: (t) => this.handleTranscript(t),
      onError: (err) => console.warn('[voice] deepgram error:', err.message),
    });

    this.livePush.emit({
      kind: 'call.started',
      call_id: frame.start.callSid,
      started_at: this.callStartMs,
      source: 'twilio',
      caller_label: this.callerNumber ? `Inbound · ${this.callerNumber}` : 'Inbound · Twilio',
    });

    void this.greet();
  }

  private handleMedia(frame: Extract<TwilioInbound, { event: 'media' }>): void {
    if (!this.deepgram) return;
    const tr = frame.media.track;
    // Twilio uses `inbound` / `outbound` in examples; skip any outbound track.
    if (tr && String(tr).toLowerCase().includes('outbound')) return;
    const mu = Buffer.from(frame.media.payload, 'base64');
    const pcm8 = muLawToPcm16(mu);
    const pcm16 = upsample8to16(pcm8);
    this.deepgram.send(pcm16);
  }

  private handleTranscript(t: {
    is_final: boolean;
    speech_final: boolean;
    channel: { alternatives: Array<{ transcript: string; confidence: number }> };
    start: number;
    duration: number;
  }): void {
    const text = t.channel.alternatives[0]?.transcript?.trim() ?? '';
    if (!text) return;
    if (!t.is_final) {
      // Barge-in: caller started speaking while agent is mid-sentence.
      if (this.speaking && text.length >= 2) this.bargeIn();
      return;
    }
    if (!this.session) return;

    const startMs = Math.round(t.start * 1000);
    const endMs = startMs + Math.round(t.duration * 1000);
    this.session.appendTurn('caller', text, startMs, endMs);
    this.callerFinalAt = performance.now();
    this.livePush.emit({
      kind: 'turn.appended',
      call_id: this.session.callId,
      turn: { speaker: 'caller', text, t_ms: Date.now() - this.callStartMs },
    });

    this.kickDecide();
  }

  private kickDecide(): void {
    if (this.deciding) {
      this.pendingDecide = true;
      return;
    }
    void this.runDecideLoop();
  }

  private async runDecideLoop(observation?: ToolResult): Promise<void> {
    if (!this.session) return;
    this.deciding = true;
    try {
      let obs: ToolResult | undefined = observation;
      // Each tool call feeds back into a follow-up decision; cap at 4 to
      // avoid a runaway loop on a confused turn.
      for (let i = 0; i < 4; i++) {
        if (this.session.terminal) break;
        const decideStart = performance.now();
        const turn = await decide(this.session, this.env, obs);
        const decideMs = performance.now() - decideStart;

        if (turn.action === 'say') {
          this.session.appendTurn(
            'agent',
            turn.text,
            Math.round(this.session.now()),
            Math.round(this.session.now()),
          );
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: turn.text, t_ms: Date.now() - this.callStartMs },
          });
          await this.speak(turn.text, decideMs);
          break;
        }

        const result = applyTool(this.session, turn);
        const summary = `[tool:${turn.action}] ${result ? JSON.stringify(result) : ''}`.slice(
          0,
          240,
        );
        this.session.appendTurn(
          'agent',
          summary,
          Math.round(this.session.now()),
          Math.round(this.session.now()),
        );
        this.livePush.emit({
          kind: 'turn.appended',
          call_id: this.session.callId,
          turn: {
            speaker: 'agent',
            text: summary,
            t_ms: Date.now() - this.callStartMs,
            action: liveActionFor(turn),
          },
        });
        if (this.session.terminal) {
          const line = closingLine(this.session.terminal);
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: line, t_ms: Date.now() - this.callStartMs },
          });
          await this.speak(line, decideMs);
          break;
        }
        obs = result ?? undefined;
      }
    } catch (err) {
      console.warn('[voice] decide loop failed:', (err as Error).message);
    } finally {
      this.deciding = false;
      if (this.pendingDecide) {
        this.pendingDecide = false;
        void this.runDecideLoop();
      } else if (this.session?.terminal) {
        await this.shutdown('agent_ended');
      }
    }
  }

  private async greet(): Promise<void> {
    if (!this.session || !this.streamSid) return;
    const text = `Hi, thanks for calling ${this.tenant.tenantName}. How can I help?`;
    this.session.appendTurn('agent', text, 0, 0);
    this.livePush.emit({
      kind: 'turn.appended',
      call_id: this.session.callId,
      turn: { speaker: 'agent', text, t_ms: 0 },
    });
    await this.speak(text, 0);
  }

  private async speak(text: string, decideMs: number): Promise<void> {
    if (!this.streamSid) return;
    return new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const session = this.session;
      const handle = streamTts({
        apiKey: this.env.ELEVENLABS_API_KEY,
        voiceId: this.env.ELEVENLABS_VOICE_ID,
        modelId: this.env.ELEVENLABS_MODEL,
        text,
        onFirstChunk: () => {
          if (session && this.callerFinalAt != null) {
            session.latency.push({
              turn_index: session.turns.length - 1,
              decide_ms: Math.round(decideMs),
              decide_to_first_audio_ms: Math.round(performance.now() - this.callerFinalAt),
            });
          }
        },
        onChunk: (mulaw) => {
          this.twilioWs.send(makeMediaFrame(this.streamSid!, mulaw.toString('base64')));
        },
        onDone: () => {
          this.speaking = null;
          this.callerFinalAt = null;
          console.info(
            `[voice] spoke ${text.length} chars in ${Math.round(performance.now() - startedAt)}ms`,
          );
          resolve();
        },
        onError: (err) => {
          console.warn('[voice] tts error:', err.message);
          this.speaking = null;
          resolve();
        },
      });
      this.speaking = handle;
    });
  }

  private bargeIn(): void {
    if (!this.streamSid || !this.speaking) return;
    console.info('[voice] barge-in detected, clearing buffer');
    this.twilioWs.send(makeClear(this.streamSid));
    this.speaking.cancel();
    this.speaking = null;
  }

  private async shutdown(reason: string): Promise<void> {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    console.info(`[voice] call ${session.callId} ending: ${reason}`);
    try {
      this.deepgram?.close();
      this.speaking?.cancel();
    } catch {
      /* ignore */
    }
    // Structured per-call summary for ops. Pull p50/p95 from these lines in
    // Railway logs (or any log aggregator) instead of from synthetic tests:
    //   `rg '"event":"call_summary"' | jq '.latency_decide_to_first_audio_ms_p95'`
    const summary = summarizeCall(session, reason);
    console.info(`[voice] call summary ${JSON.stringify(summary)}`);
    this.livePush.emit({
      kind: 'call.ended',
      call_id: session.callId,
      ended_at: Date.now(),
      reason:
        reason === 'twilio_stop' ? 'hangup' : reason === 'agent_ended' ? 'completed' : 'error',
    });
    try {
      this.twilioWs.close();
    } catch {
      /* ignore */
    }
  }
}

/** Quantile of a numeric sample. q in [0,1]. Returns null on empty input. */
function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const first = sorted[0]!;
  if (sorted.length === 1) return Math.round(first);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  const loV = sorted[lo]!;
  const hiV = sorted[hi]!;
  return Math.round(loV + (hiV - loV) * frac);
}

function summarizeCall(session: CallSession, reason: string): Record<string, unknown> {
  const decideToFirstAudio = session.latency
    .map((l) => l.decide_to_first_audio_ms)
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const decide = session.latency
    .map((l) => l.decide_ms)
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  return {
    event: 'call_summary',
    call_id: session.callId,
    tenant: session.tenantSlug,
    reason,
    duration_ms: Math.round(session.now()),
    turns: session.turns.length,
    cart_items: session.cart.length,
    terminal: session.terminal?.kind ?? null,
    latency_samples: session.latency.length,
    latency_decide_to_first_audio_ms_p50: quantile(decideToFirstAudio, 0.5),
    latency_decide_to_first_audio_ms_p95: quantile(decideToFirstAudio, 0.95),
    latency_decide_ms_p50: quantile(decide, 0.5),
    latency_decide_ms_p95: quantile(decide, 0.95),
  };
}

function liveActionFor(
  turn: { action: string } & Record<string, unknown>,
):
  | { kind: 'add_to_cart'; item: string; qty: number }
  | { kind: 'transfer_to_staff'; reason: string }
  | { kind: 'end_call' }
  | { kind: 'lookup_menu_item'; query: string }
  | undefined {
  switch (turn.action) {
    case 'add_to_cart':
      return {
        kind: 'add_to_cart',
        item: String(turn.item ?? ''),
        qty: Number(turn.qty ?? 1),
      };
    case 'transfer_to_staff':
      return { kind: 'transfer_to_staff', reason: String(turn.reason ?? '') };
    case 'end_call':
      return { kind: 'end_call' };
    case 'lookup_menu_item':
      return { kind: 'lookup_menu_item', query: String(turn.query ?? '') };
    default:
      return undefined;
  }
}

function closingLine(terminal: { kind: 'transferred' | 'ended'; reason: string }): string {
  if (terminal.kind === 'transferred') return "One sec, I'm transferring you to a person.";
  return 'Thanks for calling. Have a good one.';
}
