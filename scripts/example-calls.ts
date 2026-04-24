#!/usr/bin/env tsx
/**
 * `pnpm example-calls:build` — synthesize the two reference calls the
 * homepage plays.
 *
 * For each scenario (`order`, `allergy`):
 *   1. Render each turn to its own MP3 via ElevenLabs (different voice for
 *      caller vs agent so the playback sounds like a real conversation).
 *   2. Insert a short silence between turns to give the listener space.
 *   3. Concatenate everything to one MP3 with ffmpeg.
 *   4. Probe each per-turn clip for its real duration and write a manifest
 *      JSON the homepage uses to drive the SSE pubsub.
 *
 * Idempotent at the per-turn level: clips are keyed by `<scenario>-<idx>-<hash>.mp3`
 * so re-running with unchanged copy reuses cached audio. Pass `--force` to
 * regenerate everything.
 *
 * Output:
 *   apps/web/public/example-calls/<scenario>.mp3
 *   apps/web/public/example-calls/<scenario>.json
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may not exist; we fail below on missing API key
}

/**
 * TTS provider note: live agent uses ElevenLabs Flash v2.5 in apps/voice/.
 * The sample calls use the same provider and agent voice so the pre-recorded
 * path sounds like the real call path.
 */
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  console.error('example-calls — ELEVENLABS_API_KEY is required.');
  process.exit(1);
}

// Voices are picked to sound like a small-business phone host (agent) and
// two distinct callers, so the two-speaker conversation reads clearly without
// anyone announcing themselves.
const AGENT_VOICE = process.env.EXAMPLE_AGENT_VOICE_ID ?? 'iP95p4xoKVk53GoZ742B'; // Chris
const CALLER_VOICE_ORDER = process.env.EXAMPLE_CALLER_ORDER_VOICE_ID ?? 'TX3LPaxmHKxFdv7VOQHJ'; // Liam
const CALLER_VOICE_ALLERGY = process.env.EXAMPLE_CALLER_ALLERGY_VOICE_ID ?? 'cgSgspJ2msm6clMCkdW9'; // Jessica
const MODEL = process.env.EXAMPLE_CALLS_MODEL ?? 'eleven_flash_v2_5';
const OUTPUT_FORMAT = process.env.EXAMPLE_CALLS_OUTPUT_FORMAT ?? 'mp3_44100_128';
const VOICE_SETTINGS = {
  stability: 0.35,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
};

const FORCE = process.argv.includes('--force');

// Half a second of silence between turns so the listener can follow.
const TURN_GAP_MS = 500;

type Speaker = 'agent' | 'caller';
type ScriptedTurn = { speaker: Speaker; text: string };
type ManifestTurn = { speaker: Speaker; text: string; t_ms: number };
type Manifest = { audio_url: string; duration_ms: number; turns: ManifestTurn[] };

const SCENARIOS: Record<string, { caller_voice: string; turns: ScriptedTurn[] }> = {
  order: {
    caller_voice: CALLER_VOICE_ORDER,
    turns: [
      { speaker: 'agent', text: "Tony's Pizza, Austin. What can I get started for you?" },
      { speaker: 'caller', text: 'Hi, can I place a pickup order?' },
      {
        speaker: 'agent',
        text: 'Sure thing. We have cheese, pepperoni, and veggie pizzas in small, medium, or large. What would you like?',
      },
      { speaker: 'caller', text: 'One medium pepperoni and one large veggie.' },
      {
        speaker: 'agent',
        text: "Got it. That's one medium pepperoni and one large veggie. Your total is thirty-three ninety-eight. Can I get a name and phone number?",
      },
      { speaker: 'caller', text: "It's for Mike. The number is 512-555-0142." },
      {
        speaker: 'agent',
        text: "Thanks Mike. We'll have that ready for pickup in about 15 minutes.",
      },
    ],
  },
  allergy: {
    caller_voice: CALLER_VOICE_ALLERGY,
    turns: [
      { speaker: 'agent', text: "Tony's Pizza, Austin. What can I get started for you?" },
      {
        speaker: 'caller',
        text: 'Hi, quick question. My kid has celiac. Do you have a gluten-free pizza?',
      },
      {
        speaker: 'agent',
        text: "We don't have a gluten-free option on our menu, and I don't want to give unsafe allergy guidance. I can connect you with a person right now to help.",
      },
      { speaker: 'caller', text: 'Yeah, please. I just want to be careful.' },
      {
        speaker: 'agent',
        text: "Absolutely. One sec, I'm transferring you to a person.",
      },
    ],
  },
};

const OUT_DIR = join(repoRoot, 'apps', 'web', 'public', 'example-calls');
const CACHE_DIR = join(repoRoot, '.scratch', 'example-calls');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });

  for (const [scenario, def] of Object.entries(SCENARIOS)) {
    console.info(`[example-calls] building ${scenario}`);
    const manifest = await buildScenario(scenario, def);
    await writeFile(join(OUT_DIR, `${scenario}.json`), JSON.stringify(manifest, null, 2));
    console.info(
      `[example-calls]   wrote ${scenario}.mp3 (${(manifest.duration_ms / 1000).toFixed(1)}s, ${manifest.turns.length} turns)`,
    );
  }

  console.info('[example-calls] done');
}

async function buildScenario(
  scenario: string,
  def: { caller_voice: string; turns: ScriptedTurn[] },
): Promise<Manifest> {
  const clipPaths: string[] = [];
  const turnDurationsMs: number[] = [];

  for (let i = 0; i < def.turns.length; i++) {
    const turn = def.turns[i]!;
    const voice = turn.speaker === 'agent' ? AGENT_VOICE : def.caller_voice;
    const hash = sha8(
      `${voice}|${MODEL}|${OUTPUT_FORMAT}|${JSON.stringify(VOICE_SETTINGS)}|${turn.text}`,
    );
    const clipPath = join(CACHE_DIR, `${scenario}-${i.toString().padStart(2, '0')}-${hash}.mp3`);

    if (FORCE || !existsSync(clipPath)) {
      console.info(`[example-calls]   tts turn ${i} (${turn.speaker})`);
      await tts({ text: turn.text, voice, outPath: clipPath });
    }
    const dur = await durationMs(clipPath);
    clipPaths.push(clipPath);
    turnDurationsMs.push(dur);
  }

  const finalPath = join(OUT_DIR, `${scenario}.mp3`);
  await concatWithGaps(clipPaths, finalPath, TURN_GAP_MS);
  const duration_ms = await durationMs(finalPath);

  let cursor = 0;
  const turns: ManifestTurn[] = def.turns.map((t, i) => {
    const out: ManifestTurn = { speaker: t.speaker, text: t.text, t_ms: cursor };
    cursor += turnDurationsMs[i]! + TURN_GAP_MS;
    return out;
  });

  return {
    audio_url: `/example-calls/${scenario}.mp3`,
    duration_ms,
    turns,
  };
}

async function tts({
  text,
  voice,
  outPath,
}: {
  text: string;
  voice: string;
  outPath: string;
}): Promise<void> {
  const q = new URLSearchParams({ output_format: OUTPUT_FORMAT });
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?${q}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY!,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`elevenlabs tts ${res.status}: ${body.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
}

async function concatWithGaps(clipPaths: string[], outPath: string, gapMs: number): Promise<void> {
  const tmpDir = join(CACHE_DIR, '_concat');
  await mkdir(tmpDir, { recursive: true });
  const silencePath = join(tmpDir, `silence-${gapMs}.mp3`);
  if (!existsSync(silencePath)) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=channel_layout=mono:sample_rate=44100`,
      '-t',
      `${(gapMs / 1000).toFixed(3)}`,
      '-q:a',
      '9',
      silencePath,
    ]);
  }

  const listPath = join(tmpDir, 'list.txt');
  const lines: string[] = [];
  clipPaths.forEach((p, i) => {
    lines.push(`file '${p.replace(/'/g, "'\\''")}'`);
    if (i < clipPaths.length - 1) {
      lines.push(`file '${silencePath.replace(/'/g, "'\\''")}'`);
    }
  });
  await writeFile(listPath, lines.join('\n'));

  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
  await rm(listPath);
}

async function durationMs(path: string): Promise<number> {
  const { stdout } = await runProcess('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe failed for ${path}: ${stdout}`);
  return Math.round(seconds * 1000);
}

async function runFfmpeg(args: string[]): Promise<void> {
  await runProcess('ffmpeg', ['-loglevel', 'error', ...args]);
}

function runProcess(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('exit', (code) => {
      if (code === 0) resolveP({ stdout, stderr });
      else rejectP(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
    child.on('error', rejectP);
  });
}

function sha8(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Side note: the `audio_url` in the manifest is relative to the public dir
// because Next.js serves `apps/web/public/example-calls/foo.mp3` at
// `/example-calls/foo.mp3`. If you change the output dir, change the URL.
