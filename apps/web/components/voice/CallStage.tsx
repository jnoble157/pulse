'use client';

/**
 * The single live-call surface.
 *
 * Subscribes to `/api/calls/live` (SSE) for both example calls and real
 * Twilio calls. Renders whichever call is most recent, with turns appearing
 * one at a time at their wire-time t_ms offsets. The "play example" button
 * triggers the same channel by POSTing to `/api/calls/example`, so the UI
 * code path is identical across example and live.
 *
 * Empty state on first load tells the visitor exactly what to do.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { LiveCall, TranscriptTurn } from './types';

type Props = {
  /** Number to display + dial. Plain string in E.164 (e.g. "+15752218619"). */
  phoneNumber: string;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'error'; message: string };

type ExamplePlayback = {
  callId: string;
  scenario: 'order' | 'allergy';
  durationMs: number;
  turns: TranscriptTurn[];
  audioUrl: string;
};

const EXAMPLE_TRANSCRIPT_DELAY_MS = 350;

export function CallStage({ phoneNumber }: Props) {
  const [calls, setCalls] = useState<Record<string, LiveCall>>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [examplePlayback, setExamplePlayback] = useState<ExamplePlayback | null>(null);
  const [pending, setPending] = useState<'order' | 'allergy' | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const exampleTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearExampleTimers = useCallback(() => {
    for (const timer of exampleTimersRef.current) clearTimeout(timer);
    exampleTimersRef.current = [];
  }, []);

  const stopExamplePlayback = useCallback(() => {
    clearExampleTimers();
    setExamplePlayback(null);
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }, [clearExampleTimers]);

  // SSE subscription. Reconnects on close with a small backoff.
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let backoff = 500;

    const connect = () => {
      if (closed) return;
      setStatus((s) => (s.kind === 'connected' ? s : { kind: 'connecting' }));
      es = new EventSource('/api/calls/live');

      es.addEventListener('snapshot', (raw) => {
        try {
          const payload = JSON.parse((raw as MessageEvent).data) as { calls: LiveCall[] };
          const calls = payload.calls.filter(
            (call) => !(call.source === 'example' && call.ended_at),
          );
          setCalls((prev) => {
            const next = { ...prev };
            for (const c of calls) next[c.call_id] = c;
            return next;
          });
          const newest = calls.sort((a, b) => b.started_at - a.started_at)[0];
          if (newest) setActiveCallId((cur) => cur ?? newest.call_id);
          setStatus({ kind: 'connected' });
          backoff = 500;
        } catch {
          // ignore malformed snapshot
        }
      });

      es.addEventListener('call.started', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as {
          call_id: string;
          started_at: number;
          source: 'twilio' | 'example';
          caller_label?: string | null;
        };
        setCalls((prev) => {
          const existing = prev[ev.call_id];
          return {
            ...prev,
            [ev.call_id]: {
              call_id: ev.call_id,
              source: ev.source,
              caller_label: ev.caller_label ?? existing?.caller_label ?? null,
              started_at: ev.started_at,
              turns: existing?.turns ?? [],
            },
          };
        });
        if (ev.source === 'twilio') stopExamplePlayback();
        setActiveCallId(ev.call_id);
      });

      es.addEventListener('turn.appended', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as {
          call_id: string;
          turn: TranscriptTurn;
        };
        const isExampleTurn = ev.call_id.startsWith('example-');
        if (!isExampleTurn) {
          stopExamplePlayback();
          setActiveCallId(ev.call_id);
        }
        setCalls((prev) => {
          let cur = prev[ev.call_id];
          if (!cur) {
            cur = {
              call_id: ev.call_id,
              source: isExampleTurn ? 'example' : 'twilio',
              caller_label: null,
              started_at: Date.now(),
              turns: [],
            };
          }
          return appendTurn(prev, cur, ev.turn);
        });
      });

      es.addEventListener('call.ended', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as {
          call_id: string;
          ended_at: number;
          reason: 'hangup' | 'completed' | 'error';
        };
        setCalls((prev) => {
          const cur = prev[ev.call_id];
          if (!cur) return prev;
          return {
            ...prev,
            [ev.call_id]: { ...cur, ended_at: ev.ended_at, ended_reason: ev.reason },
          };
        });
      });

      es.onopen = () => {
        setStatus({ kind: 'connected' });
        backoff = 500;
      };

      es.onerror = () => {
        es?.close();
        if (closed) return;
        setStatus({ kind: 'reconnecting' });
        const delay = Math.min(backoff, 8000);
        backoff = Math.min(backoff * 2, 8000);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [stopExamplePlayback]);

  const scheduleExampleTranscript = useCallback(
    ({
      callId,
      scenario,
      durationMs,
      turns,
    }: {
      callId: string;
      scenario: 'order' | 'allergy';
      durationMs: number;
      turns: TranscriptTurn[];
    }) => {
      clearExampleTimers();
      const startedAt = Date.now();
      setCalls((prev) => ({
        ...prev,
        [callId]: {
          call_id: callId,
          source: 'example',
          caller_label:
            scenario === 'order' ? 'Sample call · pickup order' : 'Sample call · allergy question',
          started_at: startedAt,
          turns: [],
        },
      }));
      for (const turn of turns) {
        exampleTimersRef.current.push(
          setTimeout(() => {
            setCalls((prev) => {
              const cur = prev[callId];
              if (!cur) return prev;
              return appendTurn(prev, cur, turn);
            });
          }, turn.t_ms + EXAMPLE_TRANSCRIPT_DELAY_MS),
        );
      }
      exampleTimersRef.current.push(
        setTimeout(
          () => {
            setCalls((prev) => {
              const cur = prev[callId];
              if (!cur) return prev;
              return {
                ...prev,
                [callId]: { ...cur, ended_at: Date.now(), ended_reason: 'completed' },
              };
            });
          },
          durationMs + EXAMPLE_TRANSCRIPT_DELAY_MS + 500,
        ),
      );
    },
    [clearExampleTimers],
  );

  const playExample = useCallback(
    async (scenario: 'order' | 'allergy') => {
      if (pending) return;
      setPending(scenario);
      try {
        const res = await fetch(`/api/calls/example?scenario=${scenario}`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `failed: ${res.status}`);
        }
        const json = (await res.json()) as {
          call_id: string;
          audio_url: string;
          duration_ms: number;
          turns: TranscriptTurn[];
        };
        setActiveCallId(json.call_id);
        setCalls((prev) => ({
          ...prev,
          [json.call_id]: {
            call_id: json.call_id,
            source: 'example',
            caller_label:
              scenario === 'order'
                ? 'Sample call · pickup order'
                : 'Sample call · allergy question',
            started_at: Date.now(),
            turns: [],
          },
        }));
        setExamplePlayback({
          callId: json.call_id,
          scenario,
          durationMs: json.duration_ms,
          turns: json.turns,
          audioUrl: json.audio_url,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'failed to start example';
        setStatus({ kind: 'error', message: msg });
        setTimeout(() => setStatus({ kind: 'connected' }), 3000);
      } finally {
        setPending(null);
      }
    },
    [pending],
  );

  // Audio playback for example calls. Transcript timing starts after the
  // browser actually starts the MP3, not when the API response returns.
  useEffect(() => {
    if (!examplePlayback || !audioRef.current) return;
    const el = audioRef.current;
    let cancelled = false;
    el.src = examplePlayback.audioUrl;
    el.currentTime = 0;
    void el
      .play()
      .then(() => {
        if (cancelled) return;
        scheduleExampleTranscript({
          callId: examplePlayback.callId,
          scenario: examplePlayback.scenario,
          durationMs: examplePlayback.durationMs,
          turns: examplePlayback.turns,
        });
      })
      .catch(() => {
        // user gesture required; the click that triggered this should satisfy
      });
    return () => {
      cancelled = true;
    };
  }, [examplePlayback, scheduleExampleTranscript]);

  useEffect(() => {
    return () => {
      clearExampleTimers();
    };
  }, [clearExampleTimers]);

  const sortedCalls = useMemo(
    () => Object.values(calls).sort((a, b) => b.started_at - a.started_at),
    [calls],
  );
  const activeCall = activeCallId ? calls[activeCallId] : sortedCalls[0];

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-[0_1px_0_rgba(10,10,10,0.04),0_30px_60px_-30px_rgba(10,10,10,0.18)]">
      <PhoneHeader
        phoneNumber={phoneNumber}
        status={status}
        activeCall={activeCall ?? null}
        onPlay={playExample}
        pending={pending}
      />
      <CallTranscript call={activeCall ?? null} />
      <CallInsights call={activeCall ?? null} />
      <audio ref={audioRef} preload="auto" className="hidden" />
    </section>
  );
}

function appendTurn(
  calls: Record<string, LiveCall>,
  call: LiveCall,
  turn: TranscriptTurn,
): Record<string, LiveCall> {
  if (
    call.turns.some(
      (existing) =>
        existing.speaker === turn.speaker &&
        existing.text === turn.text &&
        existing.t_ms === turn.t_ms &&
        JSON.stringify(existing.action ?? null) === JSON.stringify(turn.action ?? null),
    )
  ) {
    return calls;
  }
  return {
    ...calls,
    [call.call_id]: { ...call, turns: [...call.turns, turn] },
  };
}

type CallInsight = {
  label: string;
  values: string[];
};

function deriveCallInsights(call: LiveCall | null): CallInsight[] {
  if (!call || call.turns.length === 0) return [];

  const transcript = call.turns.map((turn) => turn.text).join(' ');
  const lower = transcript.toLowerCase();
  const orderItems = deriveOrderItems(call, lower);
  const orderTotal = deriveOrderTotal(transcript, lower);
  const customerDetails = deriveCustomerDetails(call);
  const escalation = deriveEscalation(call, lower);
  const insights: CallInsight[] = [];

  if (orderItems.length > 0) {
    insights.push({ label: 'Order', values: orderItems });
  }
  if (orderTotal) {
    insights.push({ label: 'Total', values: [orderTotal] });
  }
  if (customerDetails.length > 0) {
    insights.push({ label: 'Customer', values: customerDetails });
  }
  if (escalation) {
    insights.push({ label: 'Next step', values: [escalation] });
  }
  insights.push({ label: 'Status', values: [deriveStatus(call, orderItems.length > 0)] });

  return insights.slice(0, 4);
}

function deriveOrderItems(call: LiveCall, lowerTranscript: string): string[] {
  const items = new Map<string, string>();
  for (const turn of call.turns) {
    if (turn.action?.kind === 'add_to_cart') {
      const value = `${turn.action.qty}x ${turn.action.item}`;
      items.set(value.toLowerCase(), value);
    }
  }

  if (items.size === 0) {
    if (lowerTranscript.includes('large pepperoni')) {
      items.set('large pepperoni', '1x Large Pepperoni Pizza');
    }
    if (lowerTranscript.includes('caesar')) {
      const caesar = lowerTranscript.includes('no croutons')
        ? '1x Caesar Salad (no croutons)'
        : '1x Caesar Salad';
      items.set('caesar', caesar);
    }
    if (
      lowerTranscript.includes('medium cheese pizza') ||
      lowerTranscript.includes('cheese pizza')
    ) {
      items.set('medium cheese pizza', '1x Medium Cheese Pizza');
    }
  }

  return [...items.values()];
}

function deriveOrderTotal(transcript: string, lowerTranscript: string): string | null {
  const dollar = transcript.match(/\$\s?(\d+(?:\.\d{2})?)/);
  if (dollar) return `$${Number(dollar[1]).toFixed(2)}`;
  if (lowerTranscript.includes('twenty-two fifty')) return '$22.50';
  if (lowerTranscript.includes('fourteen ninety-nine')) return '$14.99';
  return null;
}

function deriveCustomerDetails(call: LiveCall): string[] {
  const details: string[] = [];
  const name = findCallerName(call);
  const phone = findPhoneNumber(call);
  if (name) details.push(name);
  if (phone) details.push(phone);
  return details;
}

function findCallerName(call: LiveCall): string | null {
  for (let i = 1; i < call.turns.length; i++) {
    const prev = call.turns[i - 1]!;
    const cur = call.turns[i]!;
    if (prev.speaker !== 'agent' || cur.speaker !== 'caller') continue;
    const prompt = prev.text.toLowerCase();
    if (!prompt.includes('name')) continue;
    const cleaned = cleanCallerName(extractNameFragment(cur.text));
    return cleaned || null;
  }
  return null;
}

function extractNameFragment(text: string): string {
  const lower = text.toLowerCase();
  const andPhoneIdx = lower.indexOf('and the phone');
  if (andPhoneIdx > 0) return text.slice(0, andPhoneIdx);
  const phoneIdx = lower.indexOf('phone number');
  if (phoneIdx > 0) return text.slice(0, phoneIdx);
  return text;
}

function cleanCallerName(text: string): string {
  return text
    .replace(/^(yeah|yep|sure|okay|ok)[,.]?\s+/i, '')
    .replace(/^(it'?s|it is|this is)\s+/i, '')
    .replace(/^for\s+/i, '')
    .replace(/\b(?:[A-Z]\s*[-.]\s*){2,}[A-Z]\b\.?/g, '')
    .replace(/[.?!]+/g, '')
    .trim();
}

function findPhoneNumber(call: LiveCall): string | null {
  for (const turn of call.turns) {
    if (turn.speaker !== 'caller') continue;
    const digits = phoneDigits(turn.text);
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
  }
  return null;
}

function phoneDigits(text: string): string {
  return text.replace(/\D/g, '');
}

function deriveEscalation(call: LiveCall, lowerTranscript: string): string | null {
  const hasTransfer = call.turns.some((turn) => turn.action?.kind === 'transfer_to_staff');
  const hasAllergy = /\b(celiac|allergy|allergic|gluten|gluten-free)\b/.test(lowerTranscript);
  if (hasTransfer) return 'Manager follow-up requested';
  if (hasAllergy) return 'Allergy safety question · Escalate to manager';
  return null;
}

function deriveStatus(call: LiveCall, hasOrder: boolean): string {
  if (!call.ended_at) return 'Listening for next step';
  if (call.source === 'example') return 'Sample complete';
  if (hasOrder) return 'Order ready for staff review';
  return 'Call complete';
}

function PhoneHeader({
  phoneNumber,
  status,
  activeCall,
  onPlay,
  pending,
}: {
  phoneNumber: string;
  status: Status;
  activeCall: LiveCall | null;
  onPlay: (scenario: 'order' | 'allergy') => void;
  pending: 'order' | 'allergy' | null;
}) {
  const formatted = formatPhone(phoneNumber);
  const tel = `tel:${phoneNumber.replace(/[^+\d]/g, '')}`;

  return (
    <header className="border-b border-border bg-bg-surface-2 px-5 py-5 sm:px-7 sm:py-6">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-x-7 sm:gap-y-0">
        <div className="flex flex-col">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Try it
          </p>
          <a
            href={tel}
            className="mt-1.5 block whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-text-primary tabular hover:text-accent-black-hover sm:text-[32px]"
          >
            {formatted}
          </a>
          <p className="mt-2.5 max-w-[34ch] text-[13.5px] leading-snug text-text-secondary">
            Call from any phone. The agent picks up as Tony&rsquo;s Pizza, Austin and the transcript
            appears here as you talk.
          </p>
        </div>
        <div aria-hidden className="hidden self-stretch border-l border-border sm:block" />
        <div className="flex flex-col gap-2.5 border-t border-border pt-5 sm:border-t-0 sm:pt-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Or play a sample
          </p>
          <div className="flex flex-col gap-2 sm:max-w-[260px]">
            <SampleButton
              label="Order a pizza"
              onClick={() => onPlay('order')}
              pending={pending === 'order'}
            />
            <SampleButton
              label="Ask about an allergy"
              onClick={() => onPlay('allergy')}
              pending={pending === 'allergy'}
            />
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4 text-[12px]">
        <StatusPill status={status} activeCall={activeCall} />
        {activeCall ? <ActiveCallMeta call={activeCall} /> : null}
      </div>
    </header>
  );
}

function SampleButton({
  label,
  onClick,
  pending,
}: {
  label: string;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        'inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-pill border border-text-primary bg-text-primary px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-black-hover disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span aria-hidden className="text-[10px]">
        ▶
      </span>
      {pending ? 'Starting…' : label}
    </button>
  );
}

function StatusPill({ status, activeCall }: { status: Status; activeCall: LiveCall | null }) {
  if (status.kind === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-chip-red-hot">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-chip-red-hot" />
        {status.message}
      </span>
    );
  }
  if (status.kind === 'connecting' || status.kind === 'reconnecting') {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-text-muted" />
        {status.kind === 'connecting' ? 'Connecting' : 'Reconnecting'}
      </span>
    );
  }
  if (activeCall && !activeCall.ended_at) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-chip-green">
        <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-chip-green" />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-text-muted" />
      Ready
    </span>
  );
}

function ActiveCallMeta({ call }: { call: LiveCall }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
      {call.caller_label ?? (call.source === 'twilio' ? 'Inbound · Twilio' : 'Sample call')}
    </span>
  );
}

function CallTranscript({ call }: { call: LiveCall | null }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const turns = call?.turns ?? [];

  // Auto-scroll to newest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  if (!call || turns.length === 0) {
    return <EmptyTranscript hasCall={!!call} />;
  }

  return (
    <div
      ref={scrollRef}
      className="max-h-[480px] min-h-[280px] overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
    >
      <ol className="space-y-3">
        {turns.map((turn, i) => (
          <TurnRow key={i} turn={turn} />
        ))}
        {!call.ended_at ? <ListeningRow /> : null}
        {call.ended_at ? <EndedRow reason={call.ended_reason ?? 'completed'} /> : null}
      </ol>
    </div>
  );
}

function CallInsights({ call }: { call: LiveCall | null }) {
  const insights = useMemo(() => deriveCallInsights(call), [call]);

  return (
    <div className="border-t border-border bg-bg-surface px-5 py-5 sm:px-7">
      <div className="grid gap-4 sm:grid-cols-[150px_1fr] sm:gap-6">
        <div>
          <p className="font-mono text-[10.5px] uppercase leading-relaxed tracking-[0.18em] text-text-muted">
            Captured info
          </p>
        </div>
        <div>
          {insights.length === 0 ? (
            <p className="text-[13px] leading-snug text-text-muted">
              Call details will appear here once the agent has something useful.
            </p>
          ) : null}
          {insights.length > 0 ? (
            <dl className="grid gap-4">
              {insights.map((insight) => (
                <div
                  key={`${insight.label}:${insight.values.join('|')}`}
                  className="grid gap-1.5 sm:grid-cols-[96px_1fr] sm:gap-5"
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    {insight.label}
                  </dt>
                  <dd className="space-y-1 text-[14px] leading-snug text-text-primary">
                    {insight.values.map((value) => (
                      <p key={value}>{value}</p>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: TranscriptTurn }) {
  const isAgent = turn.speaker === 'agent';
  const hasText = turn.text.trim().length > 0;
  return (
    <li className="grid grid-cols-[64px_1fr] items-start gap-3">
      <span
        className={cn(
          'mt-1 inline-flex items-center justify-self-end font-mono text-[10px] uppercase tracking-[0.14em]',
          isAgent ? 'text-accent-yellow-hover' : 'text-text-muted',
        )}
      >
        {isAgent ? 'Agent' : 'Caller'}
      </span>
      <div>
        {hasText ? (
          <p
            className={cn(
              'whitespace-pre-wrap text-[14.5px] leading-[1.55]',
              isAgent ? 'text-text-primary' : 'text-text-secondary',
            )}
          >
            {turn.text}
          </p>
        ) : null}
        {turn.action ? <ActionChip action={turn.action} /> : null}
      </div>
    </li>
  );
}

function ActionChip({ action }: { action: NonNullable<TranscriptTurn['action']> }) {
  const label =
    action.kind === 'add_to_cart'
      ? `Added to order: ${action.qty}× ${action.item}`
      : action.kind === 'lookup_menu_item'
        ? `Looked up: ${action.query}`
        : action.kind === 'transfer_to_staff'
          ? `Transferred to staff: ${action.reason}`
          : 'Ended call';
  return (
    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-text-secondary">
      <span aria-hidden className="h-1 w-1 rounded-full bg-accent-yellow" />
      {label}
    </span>
  );
}

function ListeningRow() {
  return (
    <li className="grid grid-cols-[64px_1fr] items-start gap-3">
      <span className="mt-1 inline-flex items-center justify-self-end font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
        ···
      </span>
      <span className="inline-flex items-center gap-2 text-[13px] text-text-muted">
        <Dots />
        Listening
      </span>
    </li>
  );
}

function EndedRow({ reason }: { reason: 'hangup' | 'completed' | 'error' }) {
  const label =
    reason === 'hangup'
      ? 'Caller hung up'
      : reason === 'error'
        ? 'Call ended (error)'
        : 'Call ended';
  return (
    <li className="grid grid-cols-[64px_1fr] items-start gap-3 pt-1">
      <span className="mt-1 inline-flex items-center justify-self-end font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
        End
      </span>
      <span className="text-[12.5px] text-text-muted">{label}</span>
    </li>
  );
}

function Dots() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" />
    </span>
  );
}

function EmptyTranscript({ hasCall }: { hasCall: boolean }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-10 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        {hasCall ? 'Connecting' : 'No call yet'}
      </p>
      <p className="mt-3 max-w-[42ch] text-[14px] leading-snug text-text-secondary">
        {hasCall
          ? 'You hear the agent on your phone. Lines appear here as soon as each side speaks — if nothing shows yet, give it a second.'
          : 'Click a sample call above to hear what the agent sounds like, or dial the number to try one yourself. The transcript will appear here in real time.'}
      </p>
    </div>
  );
}

function formatPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return e164;
}
