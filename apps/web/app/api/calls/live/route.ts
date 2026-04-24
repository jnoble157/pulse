/**
 * GET /api/calls/live — SSE stream of live call events.
 *
 * On connect: emits a `snapshot` event containing every call currently in the
 * in-process store (active or recently ended). After that, every emitted
 * `CallEvent` is forwarded as a typed SSE event so subscribers can render
 * call transitions, turn appends, and end states without re-fetching.
 */
import {
  snapshotCalls,
  subscribeCallEvents,
  type CallEvent,
  type LiveCall,
} from '@/lib/live-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 15_000;

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed underneath us; cleanup runs in cancel
        }
      };

      const snapshot: LiveCall[] = snapshotCalls();
      send('snapshot', { calls: snapshot, ts: Date.now() });

      const unsubscribe = subscribeCallEvents((event: CallEvent) => {
        send(event.kind, event);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          // ignore
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Next.js doesn't currently surface a per-request abort signal to
      // ReadableStream.start; we rely on the cancel hook below for cleanup.
      ;(controller as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
    },
    cancel(reason) {
      const cleanup = (this as unknown as { __cleanup?: () => void }).__cleanup;
      if (cleanup) cleanup();
      // reason is informational; SSE clients close routinely on navigation
      void reason;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
