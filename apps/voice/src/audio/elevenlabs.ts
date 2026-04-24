/**
 * ElevenLabs streaming TTS over WebSocket.
 *
 * We open a websocket per turn (the connection cost is ~50ms; cheaper than
 * keeping one open across turns and dealing with state desync on barge-in).
 * Output format is `pcm_16000` so we can downsample to 8kHz μ-law before
 * forwarding to Twilio. The first audio chunk back is the latency we publish
 * in DEMO.md §3.
 *
 * Reference: https://elevenlabs.io/docs/api-reference/text-to-speech-websockets
 */
import { WebSocket } from 'ws';

export type TtsOptions = {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
  /** Called for every audio chunk (linear16 @ 16kHz, little-endian). */
  onChunk: (pcm16: Buffer) => void;
  onFirstChunk?: () => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
};

export function streamTts(opts: TtsOptions): { cancel: () => void } {
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/stream-input?model_id=${opts.modelId}&output_format=pcm_16000`;
  const ws = new WebSocket(url, { headers: { 'xi-api-key': opts.apiKey } });
  let cancelled = false;
  let firstChunkSeen = false;

  ws.on('open', () => {
    if (cancelled) return ws.close();
    ws.send(
      JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.45, similarity_boost: 0.7, style: 0.2 },
      }),
    );
    ws.send(JSON.stringify({ text: opts.text }));
    ws.send(JSON.stringify({ text: '' }));
  });

  ws.on('message', (data) => {
    if (cancelled) return;
    let json: { audio?: string; isFinal?: boolean } | null = null;
    try {
      json = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (json?.audio) {
      const pcm = Buffer.from(json.audio, 'base64');
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        opts.onFirstChunk?.();
      }
      opts.onChunk(pcm);
    }
    if (json?.isFinal) {
      opts.onDone?.();
      ws.close();
    }
  });

  ws.on('error', (err) => opts.onError?.(err));

  return {
    cancel: () => {
      cancelled = true;
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
  };
}

/**
 * Cheap 16kHz → 8kHz downsample by averaging adjacent samples. Phone audio
 * is bandlimited to ~3.5kHz anyway; this is the standard "good enough" path.
 */
export function downsample16to8(pcm16: Buffer): Buffer {
  const samples = pcm16.length / 2;
  const outSamples = Math.floor(samples / 2);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const a = pcm16.readInt16LE(i * 4);
    const b = pcm16.readInt16LE(i * 4 + 2);
    out.writeInt16LE(Math.round((a + b) / 2), i * 2);
  }
  return out;
}
