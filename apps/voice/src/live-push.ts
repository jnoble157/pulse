/**
 * Live-call push client.
 *
 * Forwards per-turn events from the orchestrator to the web app so the
 * homepage transcript area updates in real time as the agent talks. Fire-
 * and-forget by design: the call must not stall waiting on this, and the
 * user-facing call must still complete cleanly if the web app is down.
 *
 * Required env to enable: `WEB_BASE_URL` and `LIVE_CALLS_PUSH_TOKEN`. If
 * either is missing, calls become no-ops and the agent runs in "headless"
 * mode (still answers callers; just no homepage updates).
 */

type LiveTurn = {
  speaker: 'caller' | 'agent';
  text: string;
  t_ms: number;
  action?:
    | { kind: 'add_to_cart'; item: string; qty: number; modifiers?: string[] }
    | { kind: 'transfer_to_staff'; reason: string }
    | { kind: 'end_call' }
    | { kind: 'lookup_menu_item'; query: string };
};

type LiveEvent =
  | {
      kind: 'call.started';
      call_id: string;
      started_at: number;
      source: 'twilio' | 'example';
      caller_label?: string | null;
    }
  | { kind: 'turn.appended'; call_id: string; turn: LiveTurn }
  | {
      kind: 'call.ended';
      call_id: string;
      ended_at: number;
      reason: 'hangup' | 'completed' | 'error';
    };

export class LivePushClient {
  private static readonly REQUEST_TIMEOUT_MS = 3_000;
  private readonly endpoint: string | null;
  private readonly token: string | null;
  private warned = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: { baseUrl?: string; token?: string }) {
    this.endpoint = opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, '')}/api/calls/live/push` : null;
    this.token = opts.token ?? null;
  }

  get enabled(): boolean {
    return Boolean(this.endpoint && this.token);
  }

  emit(event: LiveEvent): void {
    if (!this.enabled) {
      if (!this.warned) {
        console.info(
          '[voice] live-push disabled (WEB_BASE_URL or LIVE_CALLS_PUSH_TOKEN unset) — homepage will not update for live calls',
        );
        this.warned = true;
      }
      return;
    }
    // Keep per-call event ordering stable (e.g. final turn before call.ended).
    this.queue = this.queue.then(() => this.send(event)).catch(() => undefined);
  }

  private async send(event: LiveEvent): Promise<void> {
    try {
      const res = await fetch(this.endpoint!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token!}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(LivePushClient.REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn(
          `[voice] live-push ${event.kind} → ${res.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`,
        );
      }
    } catch (err) {
      console.warn(`[voice] live-push ${event.kind} failed:`, (err as Error).message);
    }
  }
}
