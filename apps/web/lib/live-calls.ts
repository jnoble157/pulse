import type { LiveCall, TranscriptTurn } from '@/components/voice/types';
export type { LiveCall, TranscriptTurn };

/**
 * In-process live-call store and pub/sub.
 *
 * The voice agent (apps/voice/) posts call lifecycle + turn events to
 * `/api/calls/live/push`; that route hands events to {@link emitCallEvent}.
 * SSE subscribers attached at `/api/calls/live` receive every event after
 * subscription PLUS a snapshot of the currently-active calls so a fresh
 * page load doesn't miss anything in flight.
 *
 * Single-process by design. In a multi-instance deploy we'd back this with
 * Redis pub/sub or Postgres LISTEN/NOTIFY; for the local + single-Vercel-
 * region demo the in-memory store is the simplest thing that works.
 *
 * Calls are evicted from memory `CALL_TTL_MS` after they end so the page
 * stays fresh and we don't hold transcripts indefinitely.
 */

export type CallEvent =
  | {
      kind: 'call.started';
      call_id: string;
      started_at: number;
      source: 'twilio' | 'example';
      caller_label?: string | null;
    }
  | {
      kind: 'turn.appended';
      call_id: string;
      turn: TranscriptTurn;
    }
  | {
      kind: 'call.ended';
      call_id: string;
      ended_at: number;
      reason: 'hangup' | 'completed' | 'error';
    };

type Listener = (event: CallEvent) => void;

const CALL_TTL_MS = 1000 * 60 * 10; // 10 minutes after end

class LiveCallStore {
  private calls = new Map<string, LiveCall>();
  private listeners = new Set<Listener>();

  snapshot(): LiveCall[] {
    return [...this.calls.values()].sort((a, b) => b.started_at - a.started_at);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: CallEvent): void {
    this.apply(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors must never crash the producer
      }
    }
  }

  private apply(event: CallEvent): void {
    if (event.kind === 'call.started') {
      const existing = this.calls.get(event.call_id);
      if (existing) {
        // Turns can arrive before `call.started` (parallel live-push HTTP).
        // Merge authoritative metadata without wiping buffered turns.
        existing.source = event.source;
        existing.caller_label = event.caller_label ?? existing.caller_label;
        existing.started_at = event.started_at;
        return;
      }
      this.calls.set(event.call_id, {
        call_id: event.call_id,
        source: event.source,
        caller_label: event.caller_label ?? null,
        started_at: event.started_at,
        turns: [],
      });
      return;
    }
    let call = this.calls.get(event.call_id);
    if (!call && event.kind === 'turn.appended') {
      call = {
        call_id: event.call_id,
        source: 'twilio',
        caller_label: null,
        started_at: Date.now(),
        turns: [],
      };
      this.calls.set(event.call_id, call);
    }
    if (!call) return;
    if (event.kind === 'turn.appended') {
      if (!hasTurn(call, event.turn)) call.turns.push(event.turn);
      return;
    }
    if (event.kind === 'call.ended') {
      call.ended_at = event.ended_at;
      call.ended_reason = event.reason;
      const callId = event.call_id;
      setTimeout(() => {
        const c = this.calls.get(callId);
        if (c?.ended_at) this.calls.delete(callId);
      }, CALL_TTL_MS);
    }
  }
}

function hasTurn(call: LiveCall, turn: TranscriptTurn): boolean {
  return call.turns.some(
    (existing) =>
      existing.speaker === turn.speaker &&
      existing.text === turn.text &&
      existing.t_ms === turn.t_ms &&
      JSON.stringify(existing.action ?? null) === JSON.stringify(turn.action ?? null),
  );
}

declare global {
  var __pulseLiveCallStore: LiveCallStore | undefined;
}

const store: LiveCallStore = globalThis.__pulseLiveCallStore ?? new LiveCallStore();
if (!globalThis.__pulseLiveCallStore) globalThis.__pulseLiveCallStore = store;

export function emitCallEvent(event: CallEvent): void {
  store.emit(event);
}

export function subscribeCallEvents(listener: Listener): () => void {
  return store.subscribe(listener);
}

export function snapshotCalls(): LiveCall[] {
  return store.snapshot();
}
