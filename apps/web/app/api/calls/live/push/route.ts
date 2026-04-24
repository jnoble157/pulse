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

const TurnSchema = z.object({
  speaker: z.enum(['caller', 'agent']),
  text: z.string().min(1),
  t_ms: z.number().int().nonnegative(),
  action: z
    .union([
      z.object({ kind: z.literal('add_to_cart'), item: z.string(), qty: z.number().int().positive() }),
      z.object({ kind: z.literal('transfer_to_staff'), reason: z.string() }),
      z.object({ kind: z.literal('end_call') }),
      z.object({ kind: z.literal('lookup_menu_item'), query: z.string() }),
    ])
    .optional(),
});

const EventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('call.started'),
    call_id: z.string().min(1),
    started_at: z.number().int().nonnegative(),
    source: z.enum(['twilio', 'example']),
    caller_label: z.string().nullish(),
  }),
  z.object({
    kind: z.literal('turn.appended'),
    call_id: z.string().min(1),
    turn: TurnSchema,
  }),
  z.object({
    kind: z.literal('call.ended'),
    call_id: z.string().min(1),
    ended_at: z.number().int().nonnegative(),
    reason: z.enum(['hangup', 'completed', 'error']),
  }),
]);

const TOKEN = process.env.LIVE_CALLS_PUSH_TOKEN;

export async function POST(request: Request): Promise<Response> {
  if (TOKEN) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${TOKEN}`) {
      return new Response('unauthorized', { status: 401 });
    }
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
