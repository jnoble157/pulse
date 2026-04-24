/**
 * ElevenLabs streaming TTS over WebSocket.
 *
 * We open a websocket per turn (the connection cost is ~50ms; cheaper than
 * keeping one open across turns and dealing with state desync on barge-in).
 * Output format is `ulaw_8000`, which Twilio Media Streams can play directly.
 * Query `auto_mode=true` avoids the default chunk-length buffer on short lines.
 * The first audio chunk back is the latency we publish in DEMO.md §3.
 *
 * Reference: https://elevenlabs.io/docs/api-reference/text-to-speech-websockets
 */
import { WebSocket } from 'ws';

export type TtsOptions = {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
  /** Called for every audio chunk (G.711 μ-law @ 8kHz). */
  onChunk: (mulaw8: Buffer) => void;
  onOpen?: () => void;
  onFirstChunk?: () => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
};

export function streamTts(opts: TtsOptions): { cancel: () => void } {
  const q = new URLSearchParams({
    model_id: opts.modelId,
    output_format: 'ulaw_8000',
    auto_mode: 'true',
  });
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/stream-input?${q}`;
  const ws = new WebSocket(url, { headers: { 'xi-api-key': opts.apiKey } });
  let cancelled = false;
  let firstChunkSeen = false;

  ws.on('open', () => {
    if (cancelled) return ws.close();
    opts.onOpen?.();
    ws.send(
      JSON.stringify({
        text: ' ',
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
          speed: 1.0,
        },
      }),
    );
    const speechText = normalizeSpeechText(opts.text);
    const chunk = `${speechText.endsWith(' ') ? speechText : `${speechText} `}`;
    ws.send(JSON.stringify({ text: chunk, flush: true }));
    // End-of-input must run after flush is queued; an immediate `{ text: '' }`
    // can be processed before flush and truncate short turns to zero audio.
    setImmediate(() => {
      if (cancelled || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ text: '' }));
    });
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
      const mulaw = Buffer.from(json.audio, 'base64');
      if (mulaw.length > 0) {
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          opts.onFirstChunk?.();
        }
        opts.onChunk(mulaw);
      }
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

function normalizeSpeechText(text: string): string {
  return text.replace(/!+/g, '.');
}
