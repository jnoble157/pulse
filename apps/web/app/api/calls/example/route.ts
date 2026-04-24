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
import { z } from 'zod';
import { emitCallEvent, type CallEvent, type TranscriptTurn } from '@/lib/live-calls';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  // Emit each turn at its original offset. Done from a setTimeout chain so
  // the request returns immediately and the browser can start audio playback
  // while we drive the transcript on the server clock.
  for (const turn of manifest.turns) {
    setTimeout(() => {
      emitCallEvent({ kind: 'turn.appended', call_id: callId, turn });
    }, turn.t_ms);
  }
  setTimeout(() => {
    emitCallEvent({
      kind: 'call.ended',
      call_id: callId,
      ended_at: Date.now(),
      reason: 'completed',
    });
  }, manifest.duration_ms + 500);

  return Response.json({
    call_id: callId,
    audio_url: manifest.audio_url,
    duration_ms: manifest.duration_ms,
    turns: manifest.turns.length,
  });
}
