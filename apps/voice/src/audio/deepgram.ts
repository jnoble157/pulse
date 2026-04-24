/**
 * Deepgram streaming STT client over WebSocket.
 *
 * We use Nova-3 with linear16 @ 16kHz (we upsample from Twilio's 8kHz μ-law
 * before sending). Settings chosen for low-latency turn detection:
 *   - `interim_results=true` so we can detect the caller starting to speak
 *     mid-agent-turn (barge-in trigger).
 *   - `endpointing=350` to reduce caller cutoffs on brief pauses.
 *   - `smart_format=true` for punctuation + numerals.
 *   - `keyterm` boosted with the tenant menu for accuracy on item names.
 *
 * Reference: https://developers.deepgram.com/docs/live-streaming-audio
 */
import { WebSocket } from 'ws';

export type DeepgramTranscript = {
  is_final: boolean;
  speech_final: boolean;
  channel: { alternatives: Array<{ transcript: string; confidence: number }> };
  start: number;
  duration: number;
};

export type DeepgramOptions = {
  apiKey: string;
  language?: string;
  keyterms?: string[];
  onTranscript: (t: DeepgramTranscript) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
};

export class DeepgramSession {
  private ws: WebSocket;
  private opened = false;
  private queue: Buffer[] = [];

  constructor(opts: DeepgramOptions) {
    const url = new URL('wss://api.deepgram.com/v1/listen');
    url.searchParams.set('model', 'nova-3');
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', '16000');
    url.searchParams.set('channels', '1');
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('endpointing', '350');
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('language', opts.language ?? 'en-US');
    for (const k of opts.keyterms ?? []) url.searchParams.append('keyterm', k);

    this.ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Token ${opts.apiKey}` },
    });

    this.ws.on('open', () => {
      this.opened = true;
      for (const buf of this.queue) this.ws.send(buf);
      this.queue.length = 0;
    });
    this.ws.on('message', (data) => {
      let json: unknown;
      try {
        json = JSON.parse(data.toString());
      } catch {
        return;
      }
      const t = json as DeepgramTranscript & { type?: string };
      if (t.type !== 'Results') return;
      opts.onTranscript(t);
    });
    this.ws.on('error', (err) => opts.onError?.(err));
    this.ws.on('close', () => opts.onClose?.());
  }

  /** Send a chunk of linear16 PCM @ 16kHz. */
  send(pcm16: Buffer): void {
    if (!this.opened) {
      this.queue.push(pcm16);
      return;
    }
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm16);
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
  }
}

/**
 * Cheap 8kHz → 16kHz upsample by sample duplication. Quality is fine for STT
 * accuracy on speech bands; STT models are trained on far worse. A linear
 * interpolator would be ~3% better but adds CPU per chunk.
 */
export function upsample8to16(pcm8: Buffer): Buffer {
  const samples = pcm8.length / 2;
  const out = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s = pcm8.readInt16LE(i * 2);
    out.writeInt16LE(s, i * 4);
    out.writeInt16LE(s, i * 4 + 2);
  }
  return out;
}
