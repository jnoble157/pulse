/**
 * POST /api/calls/live/push — accept call events from the voice agent.
 *
 * The voice agent (apps/voice/) posts one event per turn so subscribers on
 * `/api/calls/live` see the call build up in real time. The example call
 * playback also posts here from the server-side route handler, so the same
 * SSE channel renders both flavors uniformly.
 *
 * Auth: shared bearer token (`LIVE_CALLS_PUSH_TOKEN`). The voice agent and
 * the example-playback route both know it; nobody else needs to.
 */
import { z } from 'zod';
import { emitCallEvent, type CallEvent } from '@/lib/live-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TurnSchema = z
  .object({
    speaker: z.enum(['caller', 'agent']),
    text: z.string().max(2_000),
    t_ms: z.number().int().nonnegative(),
    action: z
      .union([
        z.object({
          kind: z.literal('add_to_cart'),
          item: z.string().min(1).max(160),
          qty: z.number().int().positive(),
          modifiers: z.array(z.string().max(120)).max(12).optional(),
        }),
        z.object({ kind: z.literal('transfer_to_staff'), reason: z.string().min(1).max(240) }),
        z.object({ kind: z.literal('end_call') }),
        z.object({ kind: z.literal('lookup_menu_item'), query: z.string().min(1).max(160) }),
      ])
      .optional(),
  })
  .superRefine((turn, ctx) => {
    const hasText = turn.text.trim().length > 0;
    if (turn.speaker === 'caller' && !hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'caller turns require text',
      });
      return;
    }
    if (turn.speaker === 'agent' && !turn.action && !hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'agent turns need text unless an action is attached',
      });
    }
  });

const EventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call.started'),
    call_id: z.string().min(1).max(128),
    started_at: z.number().int().nonnegative(),
    source: z.enum(['twilio', 'example']),
    caller_label: z.string().max(160).nullish(),
  }),
  z.object({
    kind: z.literal('turn.appended'),
    call_id: z.string().min(1).max(128),
    turn: TurnSchema,
  }),
  z.object({
    kind: z.literal('call.ended'),
    call_id: z.string().min(1).max(128),
    ended_at: z.number().int().nonnegative(),
    reason: z.enum(['hangup', 'completed', 'error']),
  }),
]);

const TOKEN = process.env.LIVE_CALLS_PUSH_TOKEN;
const MAX_BODY_BYTES = 32_768;

function requiresPushToken(): boolean {
  return (
    process.env.PULSE_REQUIRE_PUSH_TOKEN === '1' ||
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1'
  );
}

export async function POST(request: Request): Promise<Response> {
  if (requiresPushToken() && !TOKEN) {
    return new Response('live push is disabled: LIVE_CALLS_PUSH_TOKEN is not configured', {
      status: 503,
    });
  }
  if (TOKEN) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${TOKEN}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const parsed = EventSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify(parsed.error.flatten()), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  emitCallEvent(parsed.data as CallEvent);
  return new Response(null, { status: 204 });
}
