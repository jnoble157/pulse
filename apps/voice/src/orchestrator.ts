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
 *     the agent is currently speaking **and** the opening greeting has
 *     finished, send a `clear` to Twilio and cancel the in-flight TTS.
 *     (Interim text during the greeting would otherwise cancel the greeting
 *     before the caller hears it.)
 *
 * Latency:
 *   - Stamped on the session at `caller_final → first Twilio media frame`.
 *     Surfaced in the structured call summary for Railway log review.
 */
import type { WebSocket as WsWebSocket } from 'ws';
import type { MenuItem } from '@pulse/schema';
import { CallSession, type LatencyEvent } from './session.js';
import {
  parseInbound,
  makeMediaFrame,
  makeClear,
  makeMark,
  type TwilioInbound,
} from './audio/twilio.js';
import { muLawToPcm16 } from './audio/codec.js';
import { DeepgramSession, upsample8to16 } from './audio/deepgram.js';
import { streamTts } from './audio/elevenlabs.js';
import { decide } from './brain/decide.js';
import { applyTool, type ToolResult } from './brain/tools.js';
import { LivePushClient } from './live-push.js';
import type { VoiceEnv } from './env.js';

/** Twilio 8kHz μ-law media frames are ~20ms (160 samples → 160 bytes). */
const TWILIO_MULAW_FRAME_BYTES = 160;
const TWILIO_PLAYBACK_MARK_TIMEOUT_MS = 8_000;
const MAX_DECIDE_TOOL_STEPS = 8;

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
  /** Interim barge-in is suppressed until the opening `speak()` completes. */
  private greetingDone = false;
  private greetingReplayedWithCaller = false;
  private pendingPlaybackMarks = new Map<string, () => void>();
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
        this.resolvePlaybackMark(frame.mark.name);
        return;
    }
  }

  private handleStart(frame: Extract<TwilioInbound, { event: 'start' }>): void {
    // Twilio usually duplicates streamSid at the root; some paths only set
    // `start.streamSid`. Without it, greet() bails and the caller hears silence.
    this.streamSid = frame.streamSid || frame.start.streamSid;
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
    if (!t.is_final || !t.speech_final) {
      if (this.speaking && text.length >= 2 && this.greetingDone) this.bargeIn();
      return;
    }
    if (!this.session) return;

    const startMs = Math.round(t.start * 1000);
    const endMs = startMs + Math.round(t.duration * 1000);
    this.session.appendTurn('caller', text, startMs, endMs);
    this.callerFinalAt = performance.now();
    if (!this.greetingReplayedWithCaller) {
      const greeting = this.session.turns.find((turn) => turn.speaker === 'agent');
      if (greeting) {
        this.livePush.emit({
          kind: 'turn.appended',
          call_id: this.session.callId,
          turn: { speaker: 'agent', text: greeting.text, t_ms: greeting.t_start_ms },
        });
      }
      this.greetingReplayedWithCaller = true;
    }
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
      let spokeThisLoop = false;
      let cartAddsThisLoop = 0;
      // Each tool call feeds back into a follow-up decision; cap at 8 to
      // avoid a runaway loop on a confused turn.
      for (let i = 0; i < MAX_DECIDE_TOOL_STEPS; i++) {
        if (this.session.terminal) break;
        const decideStart = performance.now();
        const turn = await decide(this.session, this.env, obs);
        const decideMs = performance.now() - decideStart;
        console.info(`[voice] decide step=${i + 1} action=${turn.action}`);

        if (turn.action === 'say') {
          const reply = turn.text ?? '';
          this.session.appendTurn(
            'agent',
            reply,
            Math.round(this.session.now()),
            Math.round(this.session.now()),
          );
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: reply, t_ms: Date.now() - this.callStartMs },
          });
          const shouldEnd = shouldAutoEndAfterSay(reply, this.session);
          await this.speak(reply, decideMs, { waitForPlayback: shouldEnd });
          spokeThisLoop = true;
          if (shouldEnd && this.session && !this.session.terminal) {
            this.session.terminal = { kind: 'ended', reason: 'completed_order' };
          }
          break;
        }

        const result = applyTool(this.session, turn);
        if (result?.kind === 'cart_added') cartAddsThisLoop += 1;
        if (
          result?.kind === 'cart_error' &&
          result.reason === 'duplicate_add_for_same_caller_turn'
        ) {
          const line = 'Got it. I have that order down. Do you want anything else?';
          this.session.appendTurn(
            'agent',
            line,
            Math.round(this.session.now()),
            Math.round(this.session.now()),
          );
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: line, t_ms: Date.now() - this.callStartMs },
          });
          await this.speak(line, decideMs);
          spokeThisLoop = true;
          break;
        }
        if (cartAddsThisLoop >= 2) {
          const line = 'Got it. I added those pizzas. Do you want anything else?';
          this.session.appendTurn(
            'agent',
            line,
            Math.round(this.session.now()),
            Math.round(this.session.now()),
          );
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: line, t_ms: Date.now() - this.callStartMs },
          });
          await this.speak(line, decideMs);
          spokeThisLoop = true;
          break;
        }
        const action = liveActionFor(turn, result);
        if (action) {
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: {
              speaker: 'agent',
              text: '',
              t_ms: Date.now() - this.callStartMs,
              action,
            },
          });
        }
        const terminalKind =
          result?.kind === 'ended'
            ? 'ended'
            : result?.kind === 'transferred'
              ? 'transferred'
              : null;
        if (terminalKind) {
          const line =
            terminalKind === 'ended'
              ? finalOrderCloseout(this.session, turn.text?.trim())
              : turn.text?.trim() ||
                closingLine({
                  kind: terminalKind,
                  reason: result?.kind === 'transferred' ? result.reason : '',
                });
          this.livePush.emit({
            kind: 'turn.appended',
            call_id: this.session.callId,
            turn: { speaker: 'agent', text: line, t_ms: Date.now() - this.callStartMs },
          });
          await this.speak(line, decideMs, { waitForPlayback: true });
          break;
        }
        obs = result ?? undefined;
      }
      if (!this.session.terminal && !spokeThisLoop) {
        const fallback = recoveryLine(this.session);
        console.warn('[voice] decide loop produced no spoken reply; sending recovery line');
        this.session.appendTurn(
          'agent',
          fallback,
          Math.round(this.session.now()),
          Math.round(this.session.now()),
        );
        this.livePush.emit({
          kind: 'turn.appended',
          call_id: this.session.callId,
          turn: { speaker: 'agent', text: fallback, t_ms: Date.now() - this.callStartMs },
        });
        await this.speak(fallback, 0);
      }
    } catch (err) {
      console.warn('[voice] decide loop failed:', (err as Error).message);
      if (this.session && !this.session.terminal) {
        const fallback = "Sorry, I didn't catch that. Could you repeat that once?";
        this.session.appendTurn(
          'agent',
          fallback,
          Math.round(this.session.now()),
          Math.round(this.session.now()),
        );
        this.livePush.emit({
          kind: 'turn.appended',
          call_id: this.session.callId,
          turn: { speaker: 'agent', text: fallback, t_ms: Date.now() - this.callStartMs },
        });
        await this.speak(fallback, 0);
      }
    } finally {
      this.deciding = false;
      if (this.pendingDecide) {
        this.pendingDecide = false;
        void this.runDecideLoop();
      } else if (this.session?.terminal) {
        await this.shutdown(
          this.session.terminal.kind === 'transferred' ? 'agent_transferred' : 'agent_ended',
        );
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
    try {
      await this.speak(text, 0, { waitForPlayback: true });
    } finally {
      this.greetingDone = true;
    }
  }

  private async speak(
    text: string,
    decideMs: number,
    opts: { waitForPlayback?: boolean } = {},
  ): Promise<void> {
    if (!this.streamSid) return;
    return new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const session = this.session;
      const callerFinalAt = this.callerFinalAt;
      let ttsOpenMs: number | null = null;
      let ttsFirstChunkMs: number | null = null;
      let firstTwilioFrameSent = false;
      let sentFrames = 0;
      console.info(
        `[voice] speak start chars=${text.length} twilio_ready_state=${this.twilioWs.readyState}`,
      );
      const handle = streamTts({
        apiKey: this.env.ELEVENLABS_API_KEY,
        voiceId: this.env.ELEVENLABS_VOICE_ID,
        modelId: this.env.ELEVENLABS_MODEL,
        text,
        onOpen: () => {
          if (callerFinalAt != null) {
            ttsOpenMs = Math.round(performance.now() - callerFinalAt);
          }
        },
        onFirstChunk: () => {
          if (callerFinalAt != null) {
            ttsFirstChunkMs = Math.round(performance.now() - callerFinalAt);
          }
        },
        onChunk: (muLaw8) => {
          console.info(`[voice] tts chunk bytes=${muLaw8.length}`);
          for (let o = 0; o < muLaw8.length; o += TWILIO_MULAW_FRAME_BYTES) {
            const slice = muLaw8.subarray(o, o + TWILIO_MULAW_FRAME_BYTES);
            try {
              this.twilioWs.send(makeMediaFrame(this.streamSid!, slice.toString('base64')));
              sentFrames++;
              if (!firstTwilioFrameSent && session && callerFinalAt != null) {
                const firstTwilioFrameMs = Math.round(performance.now() - callerFinalAt);
                firstTwilioFrameSent = true;
                session.latency.push({
                  turn_index: session.turns.length - 1,
                  decide_ms: Math.round(decideMs),
                  decide_to_first_audio_ms: firstTwilioFrameMs,
                  tts_open_ms: ttsOpenMs,
                  tts_first_chunk_ms: ttsFirstChunkMs ?? firstTwilioFrameMs,
                  first_twilio_frame_ms: firstTwilioFrameMs,
                });
              }
            } catch (err) {
              console.warn('[voice] twilio media send failed:', (err as Error).message);
              break;
            }
          }
        },
        onDone: () => {
          void (async () => {
            console.info(`[voice] tts done sent_frames=${sentFrames}`);
            if (opts.waitForPlayback && sentFrames > 0) {
              await this.waitForPlaybackMark(
                `tts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              );
            }
            this.speaking = null;
            this.callerFinalAt = null;
            console.info(
              `[voice] spoke ${text.length} chars in ${Math.round(performance.now() - startedAt)}ms`,
            );
            resolve();
          })();
        },
        onError: (err) => {
          console.warn('[voice] tts error:', err.message);
          if (sentFrames === 0 && this.session && !this.session.terminal) {
            const fallback = "Sorry, I'm having trouble speaking right now. Could you repeat that?";
            this.session.appendTurn(
              'agent',
              fallback,
              Math.round(this.session.now()),
              Math.round(this.session.now()),
            );
            this.livePush.emit({
              kind: 'turn.appended',
              call_id: this.session.callId,
              turn: { speaker: 'agent', text: fallback, t_ms: Date.now() - this.callStartMs },
            });
          }
          this.speaking = null;
          resolve();
        },
      });
      this.speaking = handle;
    });
  }

  private waitForPlaybackMark(name: string): Promise<void> {
    const streamSid = this.streamSid;
    if (!streamSid) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        this.pendingPlaybackMarks.delete(name);
        resolve();
      };
      const timeout = setTimeout(finish, TWILIO_PLAYBACK_MARK_TIMEOUT_MS);
      this.pendingPlaybackMarks.set(name, finish);
      try {
        this.twilioWs.send(makeMark(streamSid, name));
      } catch {
        finish();
      }
    });
  }

  private resolvePlaybackMark(name: string): void {
    this.pendingPlaybackMarks.get(name)?.();
  }

  private bargeIn(): void {
    if (!this.streamSid || !this.speaking) return;
    console.info('[voice] barge-in detected, clearing buffer');
    try {
      this.twilioWs.send(makeClear(this.streamSid));
    } catch (err) {
      console.warn('[voice] twilio clear send failed:', (err as Error).message);
    }
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
      for (const resolve of this.pendingPlaybackMarks.values()) resolve();
      this.pendingPlaybackMarks.clear();
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
        reason === 'twilio_stop'
          ? 'hangup'
          : reason === 'agent_ended' || reason === 'agent_transferred'
            ? 'completed'
            : 'error',
    });
    try {
      this.twilioWs.close();
    } catch {
      /* ignore */
    }
  }
}

function recoveryLine(session: CallSession): string {
  if (session.cart.length > 0) return 'Got it. Do you want anything else with that order?';
  return "Sorry, I didn't catch that. Could you repeat that once?";
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
  const decideToFirstAudio = latencyValues(session, (l) => l.decide_to_first_audio_ms);
  const decide = latencyValues(session, (l) => l.decide_ms);
  const ttsOpen = latencyValues(session, (l) => l.tts_open_ms);
  const ttsFirstChunk = latencyValues(session, (l) => l.tts_first_chunk_ms);
  const firstTwilioFrame = latencyValues(session, (l) => l.first_twilio_frame_ms);
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
    latency_tts_open_ms_p50: quantile(ttsOpen, 0.5),
    latency_tts_open_ms_p95: quantile(ttsOpen, 0.95),
    latency_tts_first_chunk_ms_p50: quantile(ttsFirstChunk, 0.5),
    latency_tts_first_chunk_ms_p95: quantile(ttsFirstChunk, 0.95),
    latency_first_twilio_frame_ms_p50: quantile(firstTwilioFrame, 0.5),
    latency_first_twilio_frame_ms_p95: quantile(firstTwilioFrame, 0.95),
  };
}

function latencyValues(
  session: CallSession,
  select: (event: LatencyEvent) => number | null,
): number[] {
  return session.latency
    .map(select)
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
}

function liveActionFor(
  turn: { action: string } & Record<string, unknown>,
  result: ToolResult | null,
):
  | { kind: 'add_to_cart'; item: string; qty: number; modifiers?: string[] }
  | { kind: 'transfer_to_staff'; reason: string }
  | { kind: 'end_call' }
  | { kind: 'lookup_menu_item'; query: string }
  | undefined {
  switch (turn.action) {
    case 'add_to_cart':
      if (result?.kind !== 'cart_added') return undefined;
      return {
        kind: 'add_to_cart',
        item: result.item.name,
        qty: Number(turn.quantity ?? 1),
        modifiers: result.item.modifiers.length > 0 ? result.item.modifiers : undefined,
      };
    case 'transfer_to_staff':
      return { kind: 'transfer_to_staff', reason: String(turn.reason ?? '') };
    case 'end_call':
      return { kind: 'end_call' };
    case 'lookup_menu_item':
      return { kind: 'lookup_menu_item', query: String(turn.name ?? '') };
    default:
      return undefined;
  }
}

function shouldAutoEndAfterSay(text: string, session: CallSession): boolean {
  if (session.terminal || session.cart.length === 0) return false;
  const normalized = text.toLowerCase();
  if (!/(\$\s?\d+(\.\d{2})?)|total\b/.test(text)) return false;
  if (/[?]/.test(text)) return false;
  if (/\b(anything else|what else|can i get|would you like|do you want)\b/.test(normalized)) {
    return false;
  }
  return /\b(all set|ready for pickup|ready soon|ready for you soon|we'll have it ready|you'?re all set)\b/.test(
    normalized,
  );
}

function closingLine(terminal: { kind: 'transferred' | 'ended'; reason: string }): string {
  if (terminal.kind === 'transferred') return "One sec, I'm transferring you to a person.";
  return 'Thanks for calling. Have a good one.';
}

function finalOrderCloseout(session: CallSession, suggested: string | undefined): string {
  if (session.cart.length === 0) return suggested || 'Thanks for calling. Have a good one.';
  const items = session.cart
    .map((item) => `${item.quantity} ${item.item_name_spoken}`)
    .join(', ')
    .trim();
  const totalCents = session.cart.reduce(
    (sum, item) => sum + (item.unit_price_cents ?? 0) * item.quantity,
    0,
  );
  const total =
    Number.isFinite(totalCents) && totalCents > 0 ? `$${(totalCents / 100).toFixed(2)}` : null;
  const firstName = callerFirstName(session);
  return [
    firstName ? `Thanks ${firstName}.` : 'Thanks for calling.',
    `We have ${items} for pickup.`,
    total ? `Your total is ${total}.` : null,
    'It will be ready in about 15 minutes.',
  ]
    .filter(Boolean)
    .join(' ');
}

function callerFirstName(session: CallSession): string | null {
  for (let i = 1; i < session.turns.length; i++) {
    const prev = session.turns[i - 1]!;
    const cur = session.turns[i]!;
    if (prev.speaker !== 'agent' || cur.speaker !== 'caller') continue;
    if (!/\bname\b/i.test(prev.text)) continue;
    const explicit =
      cur.text.match(/\bmy name is\s+([A-Za-z][A-Za-z'-]*)/i)?.[1] ??
      cur.text.match(/\bit'?s\s+([A-Za-z][A-Za-z'-]*)/i)?.[1] ??
      cur.text.match(/\bthis is\s+([A-Za-z][A-Za-z'-]*)/i)?.[1] ??
      null;
    const candidate =
      explicit ??
      cur.text
        .replace(
          /\b(?:yeah|yep|sure|okay|ok|it'?s|this is|my name is|that'?s it|nope)\b[,\s]*/gi,
          '',
        )
        .replace(/[^A-Za-z\s'-]/g, ' ')
        .trim()
        .split(/\s+/)[0];
    if (candidate && candidate.length >= 2) return capitalize(candidate);
  }
  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
