/**
 * POST /api/calls/example?scenario=order|allergy
 *
 * Plays a canned reference call through the same live-call pubsub the real
 * voice agent posts to. The browser hears the audio (loaded directly from
 * `/example-calls/<scenario>.mp3`) while the SSE channel emits the matching
 * transcript turns at their original timestamps. Result: the example renders
 * via the exact same UI path as a live call, no special-case code in the
 * components.
 *
 * Returns the audio metadata (url, duration, total turns) so the client knows
 * how to drive the `<audio>` element and what to expect.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after } from 'next/server';
import { z } from 'zod';
import { emitCallEvent, type CallEvent, type TranscriptTurn } from '@/lib/live-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

const ScenarioSchema = z.enum(['order', 'allergy']);

const SCENARIO_LABELS: Record<z.infer<typeof ScenarioSchema>, string> = {
  order: 'Sample call · pickup order',
  allergy: 'Sample call · allergy question',
};

type ExampleManifest = {
  audio_url: string;
  duration_ms: number;
  turns: TranscriptTurn[];
};

const PUBLIC_DIR = join(process.cwd(), 'public', 'example-calls');

async function loadManifest(scenario: 'order' | 'allergy'): Promise<ExampleManifest | null> {
  try {
    const raw = await readFile(join(PUBLIC_DIR, `${scenario}.json`), 'utf8');
    return JSON.parse(raw) as ExampleManifest;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ScenarioSchema.safeParse(url.searchParams.get('scenario'));
  if (!parsed.success) {
    return Response.json({ error: 'unknown scenario' }, { status: 400 });
  }
  const scenario = parsed.data;

  const manifest = await loadManifest(scenario);
  if (!manifest) {
    return Response.json(
      {
        error:
          'example call manifest missing — run `pnpm example-calls:build` to synthesize audio + transcript',
      },
      { status: 503 },
    );
  }

  const callId = `example-${scenario}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const startedEvent: CallEvent = {
    kind: 'call.started',
    call_id: callId,
    started_at: startedAt,
    source: 'example',
    caller_label: SCENARIO_LABELS[scenario],
  };
  emitCallEvent(startedEvent);

  // Vercel can freeze a serverless invocation once the response returns.
  // `after()` keeps the timed transcript driver alive while the browser starts
  // playback from the audio URL returned below.
  scheduleAfterResponse(async () => {
    await emitManifestTurns(callId, manifest);
  });

  return Response.json({
    call_id: callId,
    audio_url: manifest.audio_url,
    duration_ms: manifest.duration_ms,
    turns: manifest.turns,
  });
}

async function emitManifestTurns(callId: string, manifest: ExampleManifest): Promise<void> {
  let prev = 0;
  for (const turn of manifest.turns) {
    await sleep(Math.max(0, turn.t_ms - prev));
    emitCallEvent({ kind: 'turn.appended', call_id: callId, turn });
    prev = turn.t_ms;
  }
  await sleep(500);
  emitCallEvent({
    kind: 'call.ended',
    call_id: callId,
    ended_at: Date.now(),
    reason: 'completed',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('outside a request scope')) throw err;
    // Route unit tests call POST() directly, outside Next's request async
    // context. Run the same delayed task so fake timers can exercise it.
    void task();
  }
}
